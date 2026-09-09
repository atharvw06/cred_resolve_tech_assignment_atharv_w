from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol


@dataclass
class OriginateRequest:
    call_id: str  # internal call UUID
    borrower_phone: str
    campaign_id: str


@dataclass
class OriginateResult:
    ok: bool
    provider_call_id: str | None
    error: str | None = None  # 'TIMEOUT' | 'REJECTED' | 'PROVIDER_ERROR' | 'BLOCKED'


@dataclass
class CallStatus:
    state: str  # maps to CallState
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderEvent:
    event_id: str  # provider's unique event ID (idempotency key)
    provider_call_id: str
    event_type: str  # INITIATED | RINGING | ANSWERED | COMPLETED | FAILED
    payload: dict[str, Any] = field(default_factory=dict)


class TelecomProvider(Protocol):
    name: str

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        ...

    async def get_status(self, provider_call_id: str) -> CallStatus:
        ...

    async def stream_events(self) -> AsyncIterator[ProviderEvent]:
        ...
