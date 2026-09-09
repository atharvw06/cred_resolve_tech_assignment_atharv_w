from __future__ import annotations
import asyncio
import random
import uuid
from typing import AsyncIterator
from app.clock import Clock, WallClock
from app.providers.base import (
    CallStatus,
    OriginateRequest,
    OriginateResult,
    ProviderEvent,
    TelecomProvider,
)


class ProviderA:
    """
    Provider A: Fast, reliable, low failure rate (~2%).
    Strict in-order event emission, no duplicate events.
    """
    name: str = "A"

    def __init__(self, clock: Clock | None = None, failure_rate: float = 0.02, seed: int | None = None):
        self.clock = clock or WallClock()
        self.failure_rate = failure_rate
        self.rng = random.Random(seed)
        self._event_queue: asyncio.Queue[ProviderEvent] = asyncio.Queue()
        self._call_statuses: dict[str, str] = {}

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        # Simulate fast originate (50-150ms)
        latency_s = self.rng.uniform(0.05, 0.15)
        if hasattr(self.clock, "advance") and not hasattr(self.clock, "_is_wall"):
            self.clock.advance(latency_s)

        prov_call_id = f"prov_a_{uuid.uuid4().hex[:12]}"
        is_failed = self.rng.random() < self.failure_rate

        if is_failed:
            self._call_statuses[prov_call_id] = "FAILED"
            await self._queue_event(prov_call_id, "INITIATED")
            await self._queue_event(prov_call_id, "FAILED")
            return OriginateResult(ok=False, provider_call_id=prov_call_id, error="PROVIDER_ERROR")

        self._call_statuses[prov_call_id] = "INITIATED"
        await self._queue_event(prov_call_id, "INITIATED")
        await self._queue_event(prov_call_id, "RINGING")
        await self._queue_event(prov_call_id, "ANSWERED")
        await self._queue_event(prov_call_id, "COMPLETED")
        return OriginateResult(ok=True, provider_call_id=prov_call_id)

    async def _queue_event(self, provider_call_id: str, event_type: str) -> None:
        self._call_statuses[provider_call_id] = event_type
        event = ProviderEvent(
            event_id=f"evt_{uuid.uuid4().hex[:12]}",
            provider_call_id=provider_call_id,
            event_type=event_type,
            payload={"provider": "A", "timestamp": self.clock.now_ts()},
        )
        await self._event_queue.put(event)

    async def get_status(self, provider_call_id: str) -> CallStatus:
        st = self._call_statuses.get(provider_call_id, "COMPLETED")
        return CallStatus(state=st, raw={"provider": "A", "provider_call_id": provider_call_id})

    async def stream_events(self) -> AsyncIterator[ProviderEvent]:
        while True:
            event = await self._event_queue.get()
            yield event
            self._event_queue.task_done()
