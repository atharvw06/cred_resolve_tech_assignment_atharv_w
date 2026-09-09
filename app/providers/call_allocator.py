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
  ORDER BY last_call_ended_at NULLS FIRST
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING id, campaign_id, name, status, reserved_by, reserved_until, last_call_ended_at, last_heartbeat_at, updated_at;
"""

SQLITE_FIND_AVAILABLE_SQL = """
SELECT id, campaign_id, name, status, reserved_by, reserved_until, last_call_ended_at, last_heartbeat_at, updated_at
FROM agents
WHERE status='AVAILABLE'
ORDER BY CASE WHEN last_call_ended_at IS NULL THEN 0 ELSE 1 END, last_call_ended_at ASC
LIMIT 1;
"""


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
        # When concurrent tasks select the same candidate, the loser of the race
        # retries on the next available agent until an agent is claimed or none are available.
        now_dt = datetime.now(timezone.utc)
        reserved_until = now_dt + timedelta(seconds=ttl_seconds)

        max_attempts = 20
        for _ in range(max_attempts):
            find_res = await session.execute(text(SQLITE_FIND_AVAILABLE_SQL))
            avail_row = find_res.mappings().first()
            if not avail_row:
                await session.rollback()
                return None

            agent_id = avail_row["id"]
            update_sql = """
            UPDATE agents
            SET status='RESERVED', reserved_by=:worker_id, reserved_until=:reserved_until, updated_at=:now_dt
            WHERE id = :agent_id AND status = 'AVAILABLE';
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
