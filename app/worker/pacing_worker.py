from __future__ import annotations
import asyncio
import os
import uuid
from typing import Any
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock, WallClock
from app.config import settings
from app.db import async_session_factory
from app.domain.models import Campaign, DialDecision
from app.pacing.progressive import ProgressivePacingEngine
from app.providers.call_allocator import dial_progressive
from app.providers.circuit_breaker import CircuitBreaker
from app.providers.provider_a import ProviderA
from app.providers.provider_b import ProviderB
from app.safety.controller import SafetyController
from app.worker.reaper import Reaper


class PacingWorker:
    """
    Main worker process:
    Coordinates pacing engine propose -> safety controller approve -> call allocator dial.
    Persists all dial decisions for auditability.
    """

    def __init__(
        self,
        worker_id: str | None = None,
        clock: Clock | None = None,
        safety_controller: SafetyController | None = None,
        providers: dict[str, Any] | None = None,
    ):
        self.worker_id = worker_id or f"worker_{uuid.uuid4().hex[:8]}"
        self.clock = clock or WallClock()
        self.progressive_pacing = ProgressivePacingEngine()

        # Providers wrapped in CircuitBreakers
        prov_a = ProviderA(clock=self.clock)
        prov_b = ProviderB(clock=self.clock)
        cb_a = CircuitBreaker(provider=prov_a, clock=self.clock)
        cb_b = CircuitBreaker(provider=prov_b, clock=self.clock)
        self.providers = providers or {"A": cb_a, "B": cb_b}

        self.safety_controller = safety_controller or SafetyController(breakers=self.providers)
        self.reaper = Reaper(clock=self.clock, providers=self.providers)
        self._tick_counter: dict[str, int] = {}

    async def tick_campaign(self, campaign_id: str, session: AsyncSession) -> dict[str, Any]:
        """Execute a single atomic pacing tick for a campaign."""
        # Check dialect for Postgres advisory lock
        bind = session.bind
        dialect = bind.dialect.name if bind else "postgresql"
        if dialect == "postgresql":
            lock_id = abs(hash(campaign_id)) % (2**31 - 1)
            await session.execute(text(f"SELECT pg_advisory_xact_lock({lock_id});"))

        camp = await session.get(Campaign, campaign_id)
        if not camp or not camp.active:
            return {"status": "inactive"}

        tick_id = self._tick_counter.get(campaign_id, 0) + 1
        self._tick_counter[campaign_id] = tick_id

        # Step 1: Pacing Engine propose
        n_proposed, prop_inputs = await self.progressive_pacing.propose(
            campaign_id=campaign_id,
            session=session,
            clock=self.clock,
        )

        # Step 2: Safety Controller approve
        approval = await self.safety_controller.approve(
            campaign_id=campaign_id,
            n_proposed=n_proposed,
            session=session,
            clock=self.clock,
        )

        # Step 3: Insert dial decision audit log
        circuit_state = self.providers.get(camp.provider, getattr(self.providers.get(camp.provider), "state", "CLOSED"))
        if hasattr(circuit_state, "state"):
            circuit_state = circuit_state.state
        elif not isinstance(circuit_state, str):
            circuit_state = "CLOSED"

        decision = DialDecision(
            id=str(uuid.uuid4()),
            campaign_id=campaign_id,
            tick_id=tick_id,
            decided_at=self.clock.now(),
            agents_available=approval.inputs.get("A", 0),
            calls_initiated_or_ringing=approval.inputs.get("R", 0),
            calls_answered_or_connected=approval.inputs.get("C", 0),
            p_hat=camp.p_hat,
            d_hat=camp.d_hat,
            h_hat=camp.h_hat,
            f_available=approval.inputs.get("F", 0.0),
            alpha=camp.alpha,
            provider_circuit=circuit_state,
            n_proposed=n_proposed,
            n_approved=approval.n_approved,
            clamp_reasons=approval.clamp_reasons,
            mode_used=approval.mode_used,
        )
        session.add(decision)
        await session.commit()

        # Step 4: Dial approved calls
        dials_placed = 0
        provider = self.providers.get(camp.provider)
        if approval.n_approved > 0 and provider:
            for _ in range(approval.n_approved):
                call_id = await dial_progressive(
                    session=session,
                    campaign_id=campaign_id,
                    provider=provider,
                    worker_id=self.worker_id,
                    clock=self.clock,
                )
                if call_id:
                    dials_placed += 1

        return {
            "campaign_id": campaign_id,
            "tick_id": tick_id,
            "n_proposed": n_proposed,
            "n_approved": approval.n_approved,
            "dials_placed": dials_placed,
            "clamp_reasons": approval.clamp_reasons,
            "mode_used": approval.mode_used,
        }


async def run_worker_loop():
    """CLI / container entry point for background dialer worker."""
    worker = PacingWorker()
    while True:
        try:
            async with async_session_factory() as session:
                # Run reaper
                await worker.reaper.run_once(session)

                # Find all active campaigns
                res = await session.execute(select(Campaign.id).where(Campaign.active == True))
                campaign_ids = res.scalars().all()
                for camp_id in campaign_ids:
                    await worker.tick_campaign(camp_id, session)

            await asyncio.sleep(1.0)
        except Exception as e:
            print(f"Error in pacing worker loop: {e}")
            await asyncio.sleep(1.0)


if __name__ == "__main__":
    asyncio.run(run_worker_loop())
