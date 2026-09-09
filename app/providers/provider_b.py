from __future__ import annotations
import asyncio
from dataclasses import dataclass
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


@dataclass
class ProviderBConfig:
    latency_mean_ms: float = 300.0
    latency_p95_ms: float = 800.0
    timeout_prob: float = 0.05
    failure_prob: float = 0.10
    duplicate_event_prob: float = 0.05
    reorder_prob: float = 0.05


class ProviderB:
    """
    Provider B: The Chaos Provider.
    Configurable latency, timeouts, failures, duplicates, and out-of-order events.
    """
    name: str = "B"

    def __init__(
        self,
        config: ProviderBConfig | None = None,
        clock: Clock | None = None,
        seed: int | None = None,
    ):
        self.config = config or ProviderBConfig()
        self.clock = clock or WallClock()
        self.rng = random.Random(seed)
        self._event_queue: asyncio.Queue[ProviderEvent] = asyncio.Queue()
        self._call_statuses: dict[str, str] = {}

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        # Simulate mean / p95 latency
        latency_ms = self.rng.gauss(self.config.latency_mean_ms, 150.0)
        latency_s = max(0.05, latency_ms / 1000.0)
        if hasattr(self.clock, "advance") and not hasattr(self.clock, "_is_wall"):
            self.clock.advance(latency_s)

        # Timeout injection
        if self.rng.random() < self.config.timeout_prob:
            return OriginateResult(ok=False, provider_call_id=None, error="TIMEOUT")

        prov_call_id = f"prov_b_{uuid.uuid4().hex[:12]}"

        # Failure injection
        if self.rng.random() < self.config.failure_prob:
            self._call_statuses[prov_call_id] = "FAILED"
            evts = [
                ProviderEvent(
                    event_id=f"evt_{uuid.uuid4().hex[:12]}",
                    provider_call_id=prov_call_id,
                    event_type="INITIATED",
                    payload={"provider": "B"},
                ),
                ProviderEvent(
                    event_id=f"evt_{uuid.uuid4().hex[:12]}",
                    provider_call_id=prov_call_id,
                    event_type="FAILED",
                    payload={"provider": "B"},
                ),
            ]
            await self._enqueue_events(evts)
            return OriginateResult(ok=False, provider_call_id=prov_call_id, error="PROVIDER_ERROR")

        # Success path events: INITIATED, RINGING, ANSWERED, COMPLETED
        evts = [
            ProviderEvent(
                event_id=f"evt_{uuid.uuid4().hex[:12]}",
                provider_call_id=prov_call_id,
                event_type="INITIATED",
                payload={"provider": "B"},
            ),
            ProviderEvent(
                event_id=f"evt_{uuid.uuid4().hex[:12]}",
                provider_call_id=prov_call_id,
                event_type="RINGING",
                payload={"provider": "B"},
            ),
            ProviderEvent(
                event_id=f"evt_{uuid.uuid4().hex[:12]}",
                provider_call_id=prov_call_id,
                event_type="ANSWERED",
                payload={"provider": "B"},
            ),
            ProviderEvent(
                event_id=f"evt_{uuid.uuid4().hex[:12]}",
                provider_call_id=prov_call_id,
                event_type="COMPLETED",
                payload={"provider": "B"},
            ),
        ]
        self._call_statuses[prov_call_id] = "COMPLETED"
        await self._enqueue_events(evts)
        return OriginateResult(ok=True, provider_call_id=prov_call_id)

    async def _enqueue_events(self, events: list[ProviderEvent]) -> None:
        # Reorder injection
        if self.rng.random() < self.config.reorder_prob:
            self.rng.shuffle(events)

        for evt in events:
            await self._event_queue.put(evt)
            # Duplicate event injection (same event_id emitted again)
            if self.rng.random() < self.config.duplicate_event_prob:
                dup_evt = ProviderEvent(
                    event_id=evt.event_id,
                    provider_call_id=evt.provider_call_id,
                    event_type=evt.event_type,
                    payload=dict(evt.payload),
                )
                await self._event_queue.put(dup_evt)

    async def get_status(self, provider_call_id: str) -> CallStatus:
        st = self._call_statuses.get(provider_call_id, "COMPLETED")
        return CallStatus(state=st, raw={"provider": "B", "provider_call_id": provider_call_id})

    async def stream_events(self) -> AsyncIterator[ProviderEvent]:
        while True:
            event = await self._event_queue.get()
            yield event
            self._event_queue.task_done()
