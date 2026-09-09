from __future__ import annotations
import math
from typing import Any
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock
from app.domain.models import Agent, Call, Campaign


def update_ewma(old_val: float, new_val: float, alpha_ewma: float) -> float:
    """Standard exponential weighted moving average update."""
    return (1.0 - alpha_ewma) * old_val + alpha_ewma * new_val


class PredictivePacingEngine:
    """
    Predictive Pacing Engine:
    Calculates aggressive outbound call rate based on available agents,
    pipeline calls soon to be free (F), and historical answer rate (p_hat).
    Adapts aggressiveness via AIMD (Additive Increase, Multiplicative Decrease).
    """

    @staticmethod
    def calculate_proposal(
        A: int,
        F: float,
        p_hat: float,
        alpha: float,
    ) -> int:
        """
        n_proposed = floor(alpha * (A + F) / max(p_hat, 0.05))
        """
        p_clamped = max(p_hat, 0.05)
        raw_proposal = math.floor(alpha * (A + F) / p_clamped)
        return max(0, int(raw_proposal))

    async def propose(
        self,
        campaign_id: str,
        session: AsyncSession,
        clock: Clock,
    ) -> tuple[int, dict[str, Any]]:
        # Fetch current DB counts
        stmt_a = (
            select(func.count())
            .select_from(Agent)
            .where(Agent.campaign_id == campaign_id, Agent.status == "AVAILABLE")
        )
        A = (await session.scalar(stmt_a)) or 0

        stmt_c = (
            select(func.count())
            .select_from(Call)
            .where(Call.campaign_id == campaign_id, Call.state.in_(["ANSWERED", "CONNECTED"]))
        )
        C = (await session.scalar(stmt_c)) or 0

        camp = await session.get(Campaign, campaign_id)
        if not camp:
            return 0, {"error": "campaign_not_found"}

        F = C * min(1.0, camp.d_hat / max(camp.h_hat, 1.0))
        n_proposed = self.calculate_proposal(A=A, F=F, p_hat=camp.p_hat, alpha=camp.alpha)

        inputs = {
            "A": A,
            "C": C,
            "F": F,
            "p_hat": camp.p_hat,
            "d_hat": camp.d_hat,
            "h_hat": camp.h_hat,
            "alpha": camp.alpha,
            "mode": "PREDICTIVE",
            "timestamp": clock.now_ts(),
        }
        return n_proposed, inputs

    @staticmethod
    def on_abandoned_event(current_alpha: float) -> float:
        """Multiplicative decrease: halve alpha upon abandonment (min 0.2)."""
        return max(0.2, current_alpha / 2.0)

    @staticmethod
    def on_clean_interval(current_alpha: float) -> float:
        """Additive increase: increment alpha by 0.05 per clean interval (max 1.0)."""
        return min(1.0, current_alpha + 0.05)
