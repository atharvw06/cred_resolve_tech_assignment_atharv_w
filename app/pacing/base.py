from __future__ import annotations
from typing import Any, Protocol
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock


class PacingEngine(Protocol):
    """Protocol for dialing pacing engines (progressive, predictive)."""

    async def propose(
        self,
        campaign_id: str,
        session: AsyncSession,
        clock: Clock,
    ) -> tuple[int, dict[str, Any]]:
        """Calculate proposed number of outbound calls and snapshot inputs."""
        ...
