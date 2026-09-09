from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock, WallClock
from app.domain.fsm import call_transition
from app.domain.models import Agent, Call, ProviderEvent
from app.providers.base import ProviderEvent as ProviderEventData

EVENT_TYPE_TO_FSM_EVENT = {
    "INITIATED": "initiate",
    "RINGING": "ringing",
    "ANSWERED": "answer",
    "CONNECTED": "connect",
    "COMPLETED": "complete",
    "FAILED": "fail",
    "CANCELLED": "cancel",
    "ABANDONED": "abandon",
}


async def atomic_attach_agent(session: AsyncSession) -> dict[str, Any] | None:
    """
    Predictive safety net: Atomically attach an available agent to an answered call.
    Uses SKIP LOCKED to avoid concurrency collisions.
    """
    bind = session.bind
    dialect = bind.dialect.name if bind else "postgresql"

    if dialect == "postgresql":
        sql = """
        UPDATE agents SET status='CONNECTED', reserved_until=NULL, updated_at=now()
        WHERE id = (
          SELECT id FROM agents WHERE status='AVAILABLE'
          ORDER BY last_call_ended_at NULLS FIRST
          FOR UPDATE SKIP LOCKED LIMIT 1
        ) RETURNING id, name, status, campaign_id;
        """
        res = await session.execute(text(sql))
        row = res.mappings().first()
        return dict(row) if row else None
    else:
        # SQLite dialect handling with row-level condition
        find_sql = """
        SELECT id, name, status, campaign_id FROM agents
        WHERE status='AVAILABLE'
        ORDER BY CASE WHEN last_call_ended_at IS NULL THEN 0 ELSE 1 END, last_call_ended_at ASC
        LIMIT 1;
        """
        row = (await session.execute(text(find_sql))).mappings().first()
        if not row:
            return None
        up_sql = "UPDATE agents SET status='CONNECTED', reserved_until=NULL WHERE id=:id AND status='AVAILABLE';"
        up_res = await session.execute(text(up_sql), {"id": row["id"]})
        if up_res.rowcount > 0:
            return dict(row)
        return None


async def ingest_provider_event(
    session: AsyncSession,
    event: ProviderEventData,
    clock: Clock | None = None,
) -> tuple[str | None, bool]:
    """
    Ingest a provider event idempotently in a single transaction.
    Returns (event_row_id, was_applied).
    If event_id already exists (ON CONFLICT DO NOTHING), returns (None, False).
    """
    clk = clock or WallClock()
    now_dt = clk.now()

    # Step 1: Idempotent event insert
    event_id = event.event_id
    provider = event.payload.get("provider", "UNKNOWN")
    provider_call_id = event.provider_call_id
    event_type = event.event_type
    payload_json = json.dumps(event.payload) if isinstance(event.payload, dict) else str(event.payload)

    # Check if duplicate already exists
    existing = await session.execute(
        select(ProviderEvent.id).where(ProviderEvent.event_id == event_id)
    )
    if existing.scalar_one_or_none() is not None:
        return None, False

    new_evt = ProviderEvent(
        id=str(uuid.uuid4()),
        provider=provider,
        event_id=event_id,
        provider_call_id=provider_call_id,
        event_type=event_type,
        payload=event.payload,
        received_at=now_dt,
    )
    session.add(new_evt)
    await session.flush()

    # Step 2: Apply FSM transition to calls row if found
    fsm_event = EVENT_TYPE_TO_FSM_EVENT.get(event_type, event_type.lower())
    stmt = select(Call).where(Call.provider_call_id == provider_call_id)
    call_res = await session.execute(stmt)
    call = call_res.scalar_one_or_none()

    applied = False
    if call:
        new_state, applied = call_transition(call.state, fsm_event)
        if applied:
            call.state = new_state
            if new_state == "INITIATED":
                call.initiated_at = now_dt
            elif new_state == "ANSWERED":
                call.answered_at = now_dt
                # Predictive mode unbound call handling: try atomic attach
                if not call.agent_id:
                    attached = await atomic_attach_agent(session)
                    if attached:
                        call.agent_id = attached["id"]
                        call.state = "CONNECTED"
                        call.connected_at = now_dt
            elif new_state == "CONNECTED":
                call.connected_at = now_dt
            elif new_state in ("COMPLETED", "FAILED", "CANCELLED", "ABANDONED"):
                call.ended_at = now_dt
                if call.agent_id:
                    agent = await session.get(Agent, call.agent_id)
                    if agent and agent.status in ("CONNECTED", "DIALING", "RESERVED"):
                        agent.status = "AVAILABLE"
                        agent.last_call_ended_at = now_dt
                        agent.reserved_by = None
                        agent.reserved_until = None

    await session.commit()
    return new_evt.id, applied
