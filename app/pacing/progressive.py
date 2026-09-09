from __future__ import annotations
from typing import Any
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock
from app.domain.models import Agent


class ProgressivePacingEngine:
    """
    Progressive Pacing Engine:
    Proposes at most 1 call per currently AVAILABLE agent.
    Never exceeds agent capacity. Purely deterministic.
    """

    async def propose(
        self,
        campaign_id: str,
        session: AsyncSession,
        clock: Clock,
    ) -> tuple[int, dict[str, Any]]:
        stmt = (
            select(func.count())
            .select_from(Agent)
            .where(Agent.campaign_id == campaign_id, Agent.status == "AVAILABLE")
        )
        avail_count = (await session.scalar(stmt)) or 0
        inputs = {"A": avail_count, "mode": "PROGRESSIVE", "timestamp": clock.now_ts()}
        return avail_count, inputs
