from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.domain.models import Agent

POSTGRES_RESERVE_SQL = """
UPDATE agents
SET status='RESERVED', reserved_by=:worker_id, reserved_until=now() + (:ttl_seconds || ' seconds')::interval, updated_at=now()
WHERE id = (
  SELECT id FROM agents
  WHERE status='AVAILABLE'
    AND (last_heartbeat_at IS NULL OR last_heartbeat_at >= now() - interval '60 seconds')
    AND (reserved_until IS NULL OR reserved_until < now())
  ORDER BY last_call_ended_at NULLS FIRST, id ASC
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING id, campaign_id, name, status, reserved_by, reserved_until, last_call_ended_at, last_heartbeat_at, updated_at;
"""

SQLITE_FIND_AVAILABLE_SQL = """
SELECT id, campaign_id, name, status, reserved_by, reserved_until, last_call_ended_at, last_heartbeat_at, updated_at
FROM agents
WHERE status='AVAILABLE'
  AND (reserved_until IS NULL OR reserved_until < :now_dt)
ORDER BY CASE WHEN last_call_ended_at IS NULL THEN 0 ELSE 1 END, last_call_ended_at ASC, id ASC
LIMIT 1;
"""

POSTGRES_RESERVE_BORROWER_SQL = """
UPDATE borrowers
SET call_count = call_count + 1,
    last_called_at = now(),
    reserved_by = :worker_id,
    reserved_until = now() + (:ttl_seconds || ' seconds')::interval,
    updated_at = now()
WHERE id = (
  SELECT b.id FROM borrowers b
  WHERE b.campaign_id = :campaign_id
    AND b.suppressed = false
    AND b.call_count < b.max_attempts
    AND (b.retry_after IS NULL OR b.retry_after <= now())
    AND (b.reserved_until IS NULL OR b.reserved_until < now())
    AND NOT EXISTS (
      SELECT 1 FROM calls c
      WHERE c.borrower_id = b.id
        AND c.state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED')
    )
  ORDER BY b.priority DESC, CASE WHEN b.last_called_at IS NULL THEN 0 ELSE 1 END, b.last_called_at ASC, b.id ASC
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING id, campaign_id, phone, priority, call_count, last_called_at;
"""

SQLITE_FIND_BORROWER_SQL = """
SELECT b.id, b.phone, b.priority, b.call_count
FROM borrowers b
WHERE b.campaign_id = :campaign_id
  AND b.suppressed = 0
  AND b.call_count < b.max_attempts
  AND (b.retry_after IS NULL OR b.retry_after <= :now_dt)
  AND (b.reserved_until IS NULL OR b.reserved_until < :now_dt)
  AND NOT EXISTS (
    SELECT 1 FROM calls c
    WHERE c.borrower_id = b.id
      AND c.state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED')
  )
ORDER BY b.priority DESC, CASE WHEN b.last_called_at IS NULL THEN 0 ELSE 1 END, b.last_called_at ASC, b.id ASC
LIMIT 1;
"""


def mask_phone(phone: str) -> str:
    """Mask PII phone number, displaying only leading dial-code and trailing 4 digits."""
    if not phone or len(phone) < 7:
        return "***"
    return f"{phone[:3]}*****{phone[-4:]}"


async def reserve_agent(
    session: AsyncSession,
    worker_id: str,
    ttl_seconds: int = 30,
) -> dict[str, Any] | None:
    """
    Atomically reserve an available agent using SKIP LOCKED.
    Guarantees exactly one winning worker with zero double-reservations.
    """
    bind = session.bind
    dialect = bind.dialect.name if bind else "postgresql"

    if dialect == "postgresql":
        result = await session.execute(
            text(POSTGRES_RESERVE_SQL),
            {"worker_id": worker_id, "ttl_seconds": str(ttl_seconds)},
        )
        row = result.mappings().first()
        if row:
            await session.commit()
            return dict(row)
        await session.commit()
        return None
    else:
        # SQLite dialect handling for local concurrency testing
        now_dt = datetime.now(timezone.utc)
        reserved_until = now_dt + timedelta(seconds=ttl_seconds)

        max_attempts = 20
        for _ in range(max_attempts):
            find_res = await session.execute(
                text(SQLITE_FIND_AVAILABLE_SQL),
                {"now_dt": now_dt},
            )
            avail_row = find_res.mappings().first()
            if not avail_row:
                await session.rollback()
                return None

            agent_id = avail_row["id"]
            update_sql = """
            UPDATE agents
            SET status='RESERVED', reserved_by=:worker_id, reserved_until=:reserved_until, updated_at=:now_dt
            WHERE id = :agent_id AND (reserved_until IS NULL OR reserved_until < :now_dt);
            """
            up_res = await session.execute(
                text(update_sql),
                {
                    "worker_id": worker_id,
                    "reserved_until": reserved_until,
                    "now_dt": now_dt,
                    "agent_id": agent_id,
                },
            )
            if up_res.rowcount > 0:
                await session.commit()
                res_row = dict(avail_row)
                res_row["status"] = "RESERVED"
                res_row["reserved_by"] = worker_id
                res_row["reserved_until"] = reserved_until
                return res_row
            else:
                # Contention: another worker won this agent; retry next available
                await session.rollback()
                await session.execute(text("SELECT 1;"))

        return None


async def reserve_borrower(
    session: AsyncSession,
    campaign_id: str,
    worker_id: str = "allocator",
    ttl_seconds: int = 30,
) -> dict[str, Any] | None:
    """
    Atomically reserve an eligible borrower using SKIP LOCKED.
    Enforces campaign scoping, suppression checks, attempt limits,
    retry timestamps, and active call exclusivity.
    """
    bind = session.bind
    dialect = bind.dialect.name if bind else "postgresql"

    if dialect == "postgresql":
        result = await session.execute(
            text(POSTGRES_RESERVE_BORROWER_SQL),
            {
                "campaign_id": campaign_id,
                "worker_id": worker_id,
                "ttl_seconds": str(ttl_seconds),
            },
        )
        row = result.mappings().first()
        if row:
            await session.commit()
            return dict(row)
        await session.commit()
        return None
    else:
        # SQLite dialect handling for local concurrency testing
        now_dt = datetime.now(timezone.utc)
        reserved_until = now_dt + timedelta(seconds=ttl_seconds)

        max_attempts = 20
        for _ in range(max_attempts):
            res = await session.execute(
                text(SQLITE_FIND_BORROWER_SQL),
                {"campaign_id": campaign_id, "now_dt": now_dt},
            )
            row = res.mappings().first()
            if not row:
                await session.rollback()
                return None

            b_id = row["id"]
            up_sql = """
            UPDATE borrowers
            SET call_count = call_count + 1,
                last_called_at = :now_dt,
                reserved_by = :worker_id,
                reserved_until = :reserved_until,
                updated_at = :now_dt
            WHERE id = :b_id
              AND (reserved_until IS NULL OR reserved_until < :now_dt);
            """
            up_res = await session.execute(
                text(up_sql),
                {
                    "b_id": b_id,
                    "worker_id": worker_id,
                    "reserved_until": reserved_until,
                    "now_dt": now_dt,
                },
            )
            if up_res.rowcount > 0:
                await session.commit()
                res_row = dict(row)
                res_row["reserved_by"] = worker_id
                res_row["reserved_until"] = reserved_until
                return res_row
            else:
                await session.rollback()
                await session.execute(text("SELECT 1;"))

        return None


async def dial_progressive(
    session: AsyncSession,
    campaign_id: str,
    provider: Any,
    worker_id: str,
    clock: Any = None,
) -> str | None:
    """
    Progressive dialing flow:
    1. Reserve agent atomically
    2. Reserve borrower
    3. Call provider.originate
    4. Create call record in INITIATED state and set agent to DIALING
    """
    import uuid
    from app.domain.models import Call, Agent
    from app.providers.base import OriginateRequest

    # Step 1: Reserve agent
    agent_row = await reserve_agent(session, worker_id=worker_id)
    if not agent_row:
        return None

    # Step 2: Reserve borrower
    borrower_row = await reserve_borrower(session, campaign_id=campaign_id)
    if not borrower_row:
        # Release agent if no borrower available
        await session.execute(
            text("UPDATE agents SET status='AVAILABLE', reserved_by=NULL, reserved_until=NULL WHERE id=:id"),
            {"id": agent_row["id"]},
        )
        await session.commit()
        return None

    call_id = str(uuid.uuid4())
    req = OriginateRequest(
        call_id=call_id,
        borrower_phone=borrower_row["phone"],
        campaign_id=campaign_id,
    )

    # Step 3: Originate call via telecom provider
    res = await provider.originate(req)

    now_dt = clock.now() if clock else datetime.now(timezone.utc)
    if res.ok:
        # Step 4: Create call row in INITIATED state
        new_call = Call(
            id=call_id,
            campaign_id=campaign_id,
            borrower_id=borrower_row["id"],
            agent_id=agent_row["id"],
            provider=provider.name,
            provider_call_id=res.provider_call_id,
            state="INITIATED",
            reserved_by=worker_id,
            initiated_at=now_dt,
        )
        session.add(new_call)

        # Set agent to DIALING
        agent = await session.get(Agent, agent_row["id"])
        if agent:
            agent.status = "DIALING"
            agent.updated_at = now_dt

        await session.commit()
        return call_id
    else:
        # Step 5: Rollback agent reservation if originate failed
        agent = await session.get(Agent, agent_row["id"])
        if agent:
            agent.status = "AVAILABLE"
            agent.reserved_by = None
            agent.reserved_until = None
            agent.updated_at = now_dt
        await session.commit()
        return None
