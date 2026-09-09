from __future__ import annotations
from datetime import timedelta
from typing import Any
from sqlalchemy import text, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.clock import Clock, WallClock
from app.domain.fsm import call_transition
from app.domain.models import Agent, Call, Lease


class Reaper:
    """
    Background garbage collector and reconciler.
    Runs periodically to:
      1. Reclaim expired agent reservation leases -> AVAILABLE
      2. Offline heartbeat-stale agents
      3. Reconcile stuck calls via provider.get_status()
      4. Release expired generic leases
    """

    def __init__(self, clock: Clock | None = None, providers: dict[str, Any] | None = None):
        self.clock = clock or WallClock()
        self.providers = providers or {}

    async def run_once(self, session: AsyncSession) -> dict[str, int]:
        now_dt = self.clock.now()
        counts = {"agents_reclaimed": 0, "agents_offlined": 0, "calls_reconciled": 0, "leases_expired": 0}

        # 1. Reclaim expired agent leases
        reclaim_sql = """
        UPDATE agents
        SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, updated_at = :now_dt
        WHERE status IN ('RESERVED', 'DIALING')
          AND reserved_until IS NOT NULL
          AND reserved_until < :now_dt;
        """
        res_agents = await session.execute(text(reclaim_sql), {"now_dt": now_dt})
        counts["agents_reclaimed"] = res_agents.rowcount or 0

        # 2. Offline heartbeat-stale agents (no heartbeat in > 60 seconds)
        stale_cutoff = now_dt - timedelta(seconds=60)
        offline_sql = """
        UPDATE agents
        SET status = 'OFFLINE', reserved_by = NULL, reserved_until = NULL, updated_at = :now_dt
        WHERE status != 'OFFLINE'
          AND last_heartbeat_at IS NOT NULL
          AND last_heartbeat_at < :stale_cutoff;
        """
        res_offline = await session.execute(
            text(offline_sql),
            {"now_dt": now_dt, "stale_cutoff": stale_cutoff},
        )
        counts["agents_offlined"] = res_offline.rowcount or 0

        # 3. Reconcile stuck calls
        stuck_calls_stmt = select(Call).where(
            Call.state.in_(["INITIATED", "RINGING", "ANSWERED"]),
            Call.reserved_until.is_not(None),
            Call.reserved_until < now_dt,
        )
        stuck_calls = (await session.execute(stuck_calls_stmt)).scalars().all()
        for call in stuck_calls:
            provider = self.providers.get(call.provider)
            if provider and call.provider_call_id:
                status_res = await provider.get_status(call.provider_call_id)
                next_state, applied = call_transition(call.state, status_res.state.lower())
                if applied:
                    call.state = next_state
                    call.ended_at = now_dt
            else:
                # No provider or expired without resolution -> ABANDONED
                call.state = "ABANDONED"
                call.ended_at = now_dt

            # Release agent if bound
            if call.agent_id:
                agent = await session.get(Agent, call.agent_id)
                if agent:
                    agent.status = "AVAILABLE"
                    agent.reserved_by = None
                    agent.reserved_until = None
                    agent.last_call_ended_at = now_dt
            counts["calls_reconciled"] += 1

        # 4. Release expired leases
        lease_sql = """
        UPDATE leases
        SET released = true
        WHERE expires_at < :now_dt AND NOT released;
        """
        res_leases = await session.execute(text(lease_sql), {"now_dt": now_dt})
        counts["leases_expired"] = res_leases.rowcount or 0

        await session.commit()
        return counts
