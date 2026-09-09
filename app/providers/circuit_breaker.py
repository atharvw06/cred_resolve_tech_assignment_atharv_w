from __future__ import annotations
from typing import AsyncIterator
from app.clock import Clock, WallClock
from app.providers.base import (
    CallStatus,
    OriginateRequest,
    OriginateResult,
    ProviderEvent,
    TelecomProvider,
)


class CircuitBreaker:
    """
    Wraps a TelecomProvider with circuit-breaking capabilities.
    States:
      - CLOSED: normal execution, monitoring failure EWMA and consecutive errors.
      - OPEN: requests blocked (returns OriginateResult(ok=False, error='BLOCKED'))
      - HALF_OPEN: 1 trial probe allowed after cooldown_seconds.
    """

    def __init__(
        self,
        provider: TelecomProvider,
        clock: Clock | None = None,
        failure_threshold: float = 0.3,
        latency_threshold_ms: float = 1000.0,
        consecutive_failure_threshold: int = 5,
        cooldown_seconds: float = 30.0,
    ):
        self.provider = provider
        self.clock = clock or WallClock()
        self.failure_threshold = failure_threshold
        self.latency_threshold_ms = latency_threshold_ms
        self.consecutive_failure_threshold = consecutive_failure_threshold
        self.cooldown_seconds = cooldown_seconds

        self._state: str = "CLOSED"
        self._consecutive_failures: int = 0
        self._failure_ewma: float = 0.0
        self._latency_ewma_ms: float = 100.0
        self._opened_at: float | None = None
        self._half_open_in_flight: bool = False

    @property
    def name(self) -> str:
        return self.provider.name

    @property
    def state(self) -> str:
        current_time = self.clock.now_ts()
        if self._state == "OPEN":
            if self._opened_at is not None and (current_time - self._opened_at) >= self.cooldown_seconds:
                self._state = "HALF_OPEN"
                self._half_open_in_flight = False
        return self._state

    def record_success(self, latency_ms: float = 100.0) -> None:
        self._consecutive_failures = 0
        self._failure_ewma = 0.8 * self._failure_ewma + 0.2 * 0.0
        self._latency_ewma_ms = 0.8 * self._latency_ewma_ms + 0.2 * latency_ms
        self._state = "CLOSED"
        self._half_open_in_flight = False

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        self._failure_ewma = 0.8 * self._failure_ewma + 0.2 * 1.0
        if (
            self._consecutive_failures >= self.consecutive_failure_threshold
            or self._failure_ewma > self.failure_threshold
        ):
            self._state = "OPEN"
            self._opened_at = self.clock.now_ts()
            self._half_open_in_flight = False

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        st = self.state
        if st == "OPEN":
            return OriginateResult(ok=False, provider_call_id=None, error="BLOCKED")

        if st == "HALF_OPEN":
            if self._half_open_in_flight:
                return OriginateResult(ok=False, provider_call_id=None, error="BLOCKED")
            self._half_open_in_flight = True

        res = await self.provider.originate(req)

        if res.ok:
            self.record_success()
        else:
            self.record_failure()

        return res

    async def get_status(self, provider_call_id: str) -> CallStatus:
        return await self.provider.get_status(provider_call_id)

    async def stream_events(self) -> AsyncIterator[ProviderEvent]:
        async for evt in self.provider.stream_events():
            yield evt
