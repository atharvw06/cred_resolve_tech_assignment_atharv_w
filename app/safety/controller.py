from __future__ import annotations
from dataclasses import dataclass, field
from datetime import timedelta
import math
from typing import Any
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock, WallClock
from app.domain.models import Agent, Call, Campaign


@dataclass
class Approval:
    n_approved: int
    clamp_reasons: list[str] = field(default_factory=list)
    mode_used: str = "PROGRESSIVE"
    inputs: dict[str, Any] = field(default_factory=dict)


def clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


class SafetyController:
    """
    Safety Controller Firewall:
    Recomputes all agent and call counts from DB.
    Guarantees no over-dialing via binomial safety inequality.
    The pacing engine cannot disable this controller.
    """

    def __init__(self, breakers: dict[str, Any] | None = None):
        self.breakers = breakers or {}

    @staticmethod
    def approve_pure(
        n_proposed: int,
        A: int,
        R: int,
        C: int,
        p_hat: float,
        sigma_hat: float,
        alpha: float,
        d_hat: float,
        h_hat: float,
        circuit_state: str = "CLOSED",
        is_stale: bool = False,
        abandonment_rate: float = 0.0,
    ) -> Approval:
        """
        Pure calculation of the safety bound for deterministic verification and property tests.
        """
        F = C * min(1.0, d_hat / max(h_hat, 1.0))
        u = clamp(p_hat + 2.0 * sigma_hat, 0.05, 0.98)
        z = 2.33  # 99th percentile standard normal

        # Solve for x = sqrt(R + n):
        # u * x^2 + z * sqrt(u*(1-u)) * x - (A + F) <= 0
        inner = z * math.sqrt(u * (1.0 - u))
        discriminant = inner * inner + 4.0 * u * (A + F)
        x_max = (-inner + math.sqrt(max(0.0, discriminant))) / (2.0 * u)
        n_max = max(0, int(math.floor(x_max * x_max - R)))

        n_approved = min(n_proposed, n_max)
        clamp_reasons: list[str] = []
        if n_approved < n_proposed:
            clamp_reasons.append("binomial_safety_bound")

        if circuit_state == "OPEN":
            n_approved = 0
            clamp_reasons.append("circuit_open")

        if is_stale:
            n_approved = min(n_approved, A)
            clamp_reasons.append("metrics_stale_progressive_fallback")

        if abandonment_rate > 0.03:
            n_approved = min(n_approved, A)
            clamp_reasons.append("abandonment_cooldown_3pct")

        mode_used = (
            "PROGRESSIVE"
            if any("progressive" in r.lower() or "cooldown" in r.lower() for r in clamp_reasons)
            else "PREDICTIVE"
        )

        return Approval(
            n_approved=n_approved,
            clamp_reasons=clamp_reasons,
            mode_used=mode_used,
            inputs={
                "A": A,
                "R": R,
                "C": C,
                "p_hat": p_hat,
                "sigma_hat": sigma_hat,
                "alpha": alpha,
                "d_hat": d_hat,
                "h_hat": h_hat,
                "F": F,
                "u": u,
                "n_max": n_max,
            },
        )

    async def approve(
        self,
        campaign_id: str,
        n_proposed: int,
        session: AsyncSession,
        clock: Clock | None = None,
    ) -> Approval:
        clk = clock or WallClock()

        # Step 1: Recompute A, R, C strictly from the database
        stmt_a = (
            select(func.count())
            .select_from(Agent)
            .where(Agent.campaign_id == campaign_id, Agent.status == "AVAILABLE")
        )
        A = (await session.scalar(stmt_a)) or 0

        stmt_r = (
            select(func.count())
            .select_from(Call)
            .where(Call.campaign_id == campaign_id, Call.state.in_(["INITIATED", "RINGING"]))
        )
        R = (await session.scalar(stmt_r)) or 0

        stmt_c = (
            select(func.count())
            .select_from(Call)
            .where(Call.campaign_id == campaign_id, Call.state.in_(["ANSWERED", "CONNECTED"]))
        )
        C = (await session.scalar(stmt_c)) or 0

        # Step 1b: Reconstruct rolling abandonment rate directly from database calls
        window_start = clk.now() - timedelta(minutes=15)
        stmt_abn = (
            select(
                func.count().filter(Call.state == "ABANDONED"),
                func.count().filter(Call.state.in_(["ANSWERED", "CONNECTED", "COMPLETED", "ABANDONED"])),
            )
            .select_from(Call)
            .where(Call.campaign_id == campaign_id, Call.created_at >= window_start)
        )
        abn_row = (await session.execute(stmt_abn)).first()
        abn_count = abn_row[0] if abn_row else 0
        total_answered_in_window = abn_row[1] if abn_row else 0
        abandonment_rate = (
            (abn_count / total_answered_in_window)
            if total_answered_in_window > 0
            else 0.0
        )

        # Step 2: Fetch campaign parameters
        camp = await session.get(Campaign, campaign_id)
        if not camp:
            return Approval(n_approved=0, clamp_reasons=["campaign_not_found"], mode_used="PROGRESSIVE")

        circuit_state = "CLOSED"
        if camp.provider in self.breakers:
            b = self.breakers[camp.provider]
            circuit_state = getattr(b, "state", "CLOSED")
            if not isinstance(circuit_state, str):
                circuit_state = "CLOSED"

        if camp.mode == "PROGRESSIVE":
            n_approved = min(n_proposed, A)
            clamp_reasons = []
            if n_approved < n_proposed:
                clamp_reasons.append("agent_capacity_bound")
            if circuit_state == "OPEN":
                n_approved = 0
                clamp_reasons.append("circuit_open")
            return Approval(
                n_approved=n_approved,
                clamp_reasons=clamp_reasons,
                mode_used="PROGRESSIVE",
                inputs={"A": A, "R": R, "C": C, "mode": "PROGRESSIVE"},
            )

        # Predictive mode: apply mathematical safety bounds
        is_stale = False
        if camp.progressive_cooldown_until and camp.progressive_cooldown_until > clk.now():
            is_stale = True

        return self.approve_pure(
            n_proposed=n_proposed,
            A=A,
            R=R,
            C=C,
            p_hat=camp.p_hat,
            sigma_hat=camp.sigma_hat,
            alpha=camp.alpha,
            d_hat=camp.d_hat,
            h_hat=camp.h_hat,
            circuit_state=circuit_state,
            is_stale=is_stale,
            abandonment_rate=abandonment_rate,
        )
