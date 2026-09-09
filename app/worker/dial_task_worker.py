from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock, WallClock
from app.domain.models import Agent, Borrower, Call, DialTask
from app.domain.enums import CallState, DialTaskState
from app.providers.base import OriginateRequest
from app.providers.call_allocator import reserve_agent, reserve_borrower, mask_phone

logger = logging.getLogger(__name__)

POSTGRES_CLAIM_TASK_SQL = """
UPDATE dial_tasks
SET state = 'PROCESSING',
    claimed_by = :worker_id,
    claimed_until = now() + (:lease_seconds || ' seconds')::interval,
    attempt_count = attempt_count + 1,
    updated_at = now()
WHERE id = (
  SELECT id FROM dial_tasks
  WHERE state = 'PENDING'
    AND (campaign_id = :campaign_id OR :campaign_id IS NULL)
  ORDER BY created_at ASC, id ASC
  FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING id, campaign_id, decision_id, idempotency_key, state, attempt_count, provider;
"""

SQLITE_CLAIM_TASK_SQL = """
SELECT id, campaign_id, decision_id, idempotency_key, state, attempt_count, provider
FROM dial_tasks
WHERE state = 'PENDING'
  AND (campaign_id = :campaign_id OR :campaign_id IS NULL)
ORDER BY created_at ASC, id ASC
LIMIT 1;
"""


class DialTaskWorker:
    """
    Durable Dial-Task Delivery Worker:
    Decoupled from campaign decision locking.
    Claims pending DialTasks via FOR UPDATE SKIP LOCKED, claims agents and borrowers atomically,
    and invokes remote telecom providers outside long-lived database transactions.
    """

    def __init__(
        self,
        worker_id: str | None = None,
        clock: Clock | None = None,
        providers: dict[str, Any] | None = None,
        lease_seconds: int = 30,
    ):
        self.worker_id = worker_id or f"task_worker_{uuid.uuid4().hex[:8]}"
        self.clock = clock or WallClock()
        self.providers = providers or {}
        self.lease_seconds = lease_seconds

    async def claim_task(
        self,
        session: AsyncSession,
        campaign_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Claim the next available pending dial task using SKIP LOCKED."""
        bind = session.bind
        dialect = bind.dialect.name if bind else "postgresql"

        if dialect == "postgresql":
            res = await session.execute(
                text(POSTGRES_CLAIM_TASK_SQL),
                {
                    "worker_id": self.worker_id,
                    "lease_seconds": str(self.lease_seconds),
                    "campaign_id": campaign_id,
                },
            )
            row = res.mappings().first()
            if row:
                await session.commit()
                return dict(row)
            await session.commit()
            return None
        else:
            # SQLite dialect fallback for concurrency unit tests
            now_dt = datetime.now(timezone.utc)
            claimed_until = now_dt + timedelta(seconds=self.lease_seconds)

            for _ in range(20):
                find_res = await session.execute(
                    text(SQLITE_CLAIM_TASK_SQL),
                    {"campaign_id": campaign_id},
                )
                row = find_res.mappings().first()
                if not row:
                    await session.rollback()
                    return None

                task_id = row["id"]
                up_sql = """
                UPDATE dial_tasks
                SET state = 'PROCESSING',
                    claimed_by = :worker_id,
                    claimed_until = :claimed_until,
                    attempt_count = attempt_count + 1,
                    updated_at = :now_dt
                WHERE id = :task_id AND state = 'PENDING';
                """
                up_res = await session.execute(
                    text(up_sql),
                    {
                        "task_id": task_id,
                        "worker_id": self.worker_id,
                        "claimed_until": claimed_until,
                        "now_dt": now_dt,
                    },
                )
                if up_res.rowcount > 0:
                    await session.commit()
                    res_row = dict(row)
                    res_row["state"] = "PROCESSING"
                    res_row["claimed_by"] = self.worker_id
                    res_row["claimed_until"] = claimed_until
                    return res_row
                else:
                    await session.rollback()
                    await session.execute(text("SELECT 1;"))

            return None

    async def execute_task(
        self,
        task: dict[str, Any],
        session: AsyncSession,
    ) -> str | None:
        """
        Deliver a claimed task:
        1. Reserve agent atomically
        2. Reserve borrower atomically
        3. Invoke provider.originate outside of decision transaction
        4. Persist call state and update dial_task status
        """
        task_id = task["id"]
        campaign_id = task["campaign_id"]
        provider_name = task.get("provider", "A")
        provider = self.providers.get(provider_name)
        idempotency_key = task.get("idempotency_key", str(uuid.uuid4()))

        # Step 1: Claim agent
        agent = await reserve_agent(session, worker_id=self.worker_id, ttl_seconds=self.lease_seconds)
        if not agent:
            # No agent ready: revert task to PENDING for next tick
            await session.execute(
                text("UPDATE dial_tasks SET state='PENDING', claimed_by=NULL, claimed_until=NULL WHERE id=:id"),
                {"id": task_id},
            )
            await session.commit()
            return None

        # Step 2: Claim borrower
        borrower = await reserve_borrower(session, campaign_id=campaign_id, worker_id=self.worker_id, ttl_seconds=self.lease_seconds)
        if not borrower:
            # Release agent, revert task to PENDING
            await session.execute(
                text("UPDATE agents SET status='AVAILABLE', reserved_by=NULL, reserved_until=NULL WHERE id=:id"),
                {"id": agent["id"]},
            )
            await session.execute(
                text("UPDATE dial_tasks SET state='PENDING', claimed_by=NULL, claimed_until=NULL WHERE id=:id"),
                {"id": task_id},
            )
            await session.commit()
            return None

        call_id = str(uuid.uuid4())
        req = OriginateRequest(
            call_id=call_id,
            borrower_phone=borrower["phone"],
            campaign_id=campaign_id,
        )

        now_dt = self.clock.now()

        # Step 3: Invoke telecom provider outside long-lived decision transactions
        try:
            res = await provider.originate(req) if provider else None
            is_ok = res.ok if res else False
            provider_call_id = res.provider_call_id if res else None
        except Exception as e:
            logger.error(f"Provider originate exception for task {task_id}: {e}")
            is_ok = False
            provider_call_id = None

        if is_ok:
            # Step 4: Persist Call in INITIATED and transition agent to DIALING
            new_call = Call(
                id=call_id,
                campaign_id=campaign_id,
                borrower_id=borrower["id"],
                agent_id=agent["id"],
                provider=provider_name,
                provider_call_id=provider_call_id,
                state="INITIATED",
                reserved_by=self.worker_id,
                initiated_at=now_dt,
            )
            session.add(new_call)

            # Update DialTask to DISPATCHED
            await session.execute(
                text(
                    """
                    UPDATE dial_tasks
                    SET state = 'DISPATCHED',
                        call_id = :call_id,
                        agent_id = :agent_id,
                        borrower_id = :borrower_id,
                        provider_call_id = :provider_call_id,
                        updated_at = :now_dt
                    WHERE id = :task_id
                    """
                ),
                {
                    "task_id": task_id,
                    "call_id": call_id,
                    "agent_id": agent["id"],
                    "borrower_id": borrower["id"],
                    "provider_call_id": provider_call_id,
                    "now_dt": now_dt,
                },
            )

            # Transition Agent to DIALING
            db_agent = await session.get(Agent, agent["id"])
            if db_agent:
                db_agent.status = "DIALING"
                db_agent.updated_at = now_dt

            await session.commit()
            logger.info(f"DialTask {task_id} successfully dispatched call {call_id} to borrower {mask_phone(borrower.get('phone', ''))}")
            return call_id
        else:
            # Failed originate: update DialTask and release agent
            await session.execute(
                text(
                    """
                    UPDATE dial_tasks
                    SET state = 'FAILED',
                        last_error = 'Provider origination failure',
                        updated_at = :now_dt
                    WHERE id = :task_id
                    """
                ),
                {"task_id": task_id, "now_dt": now_dt},
            )
            db_agent = await session.get(Agent, agent["id"])
            if db_agent:
                db_agent.status = "AVAILABLE"
                db_agent.reserved_by = None
                db_agent.reserved_until = None
                db_agent.updated_at = now_dt

            # Release borrower
            await session.execute(
                text("UPDATE borrowers SET reserved_by=NULL, reserved_until=NULL WHERE id=:id"),
                {"id": borrower["id"]},
            )
            await session.commit()
            return None
