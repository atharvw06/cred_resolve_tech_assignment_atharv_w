from __future__ import annotations
import pytest
from app.clock import SimClock
from app.providers.base import (
    CallStatus,
    OriginateRequest,
    OriginateResult,
    TelecomProvider,
)
from app.providers.circuit_breaker import CircuitBreaker


class MockFailingProvider:
    name = "mock_failing"

    def __init__(self, should_fail: bool = True):
        self.should_fail = should_fail
        self.originate_call_count = 0

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        self.originate_call_count += 1
        if self.should_fail:
            return OriginateResult(ok=False, provider_call_id=None, error="PROVIDER_ERROR")
        return OriginateResult(ok=True, provider_call_id="call_ok_123")

    async def get_status(self, provider_call_id: str) -> CallStatus:
        return CallStatus(state="COMPLETED")

    async def stream_events(self):
        if False:
            yield None


@pytest.mark.asyncio
async def test_circuit_breaker_trips_on_5_consecutive_failures():
    """5 consecutive originate failures -> CLOSED -> OPEN. Subsequent calls BLOCKED."""
    clock = SimClock(start=1000.0)
    provider = MockFailingProvider(should_fail=True)
    breaker = CircuitBreaker(
        provider=provider,
        clock=clock,
        failure_threshold=0.8,
        consecutive_failure_threshold=5,
        cooldown_seconds=30.0,
    )

    req = OriginateRequest(call_id="c1", borrower_phone="+1234567890", campaign_id="camp1")

    assert breaker.state == "CLOSED"

    # 4 consecutive failures -> still CLOSED
    for _ in range(4):
        res = await breaker.originate(req)
        assert res.ok is False
        assert res.error == "PROVIDER_ERROR"
        assert breaker.state == "CLOSED"

    # 5th failure -> trips to OPEN
    res = await breaker.originate(req)
    assert res.ok is False
    assert breaker.state == "OPEN"

    # Next call is BLOCKED without calling underlying provider
    count_before = provider.originate_call_count
    res = await breaker.originate(req)
    assert res.ok is False
    assert res.error == "BLOCKED"
    assert provider.originate_call_count == count_before


@pytest.mark.asyncio
async def test_circuit_breaker_half_open_probe_and_recovery():
    """After cooldown, HALF_OPEN probe succeeds -> returns to CLOSED."""
    clock = SimClock(start=1000.0)
    provider = MockFailingProvider(should_fail=True)
    breaker = CircuitBreaker(
        provider=provider,
        clock=clock,
        consecutive_failure_threshold=5,
        cooldown_seconds=30.0,
    )
    req = OriginateRequest(call_id="c1", borrower_phone="+1234567890", campaign_id="camp1")

    # Trip breaker
    for _ in range(5):
        await breaker.originate(req)
    assert breaker.state == "OPEN"

    # Advance clock by 29s (still in cooldown)
    clock.advance(29.0)
    assert breaker.state == "OPEN"

    # Advance clock past cooldown (31s total) -> transitions to HALF_OPEN
    clock.advance(2.0)
    assert breaker.state == "HALF_OPEN"

    # Provider now recovers
    provider.should_fail = False

    # Probe call succeeds
    probe_res = await breaker.originate(req)
    assert probe_res.ok is True
    assert breaker.state == "CLOSED"
