from __future__ import annotations
import os
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.clock import SimClock
from app.domain.models import Agent, Base, Borrower, Call
from app.providers.base import CallStatus, OriginateRequest, OriginateResult
from app.worker.reaper import Reaper

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


class MockReaperProvider:
    name = "A"

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        return OriginateResult(ok=True, provider_call_id="prov_crash_1")

    async def get_status(self, provider_call_id: str) -> CallStatus:
        return CallStatus(state="COMPLETED")

    async def stream_events(self):
        if False:
            yield None


@pytest.fixture
async def db_session_maker():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_maker
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_worker_crash_and_ttl_reaper_recovery(db_session_maker):
    """
    Failure Drill 1:
    Worker crashes after reserving agent and initiating call.
    Reaper reclaims expired lease after TTL, flips agent back to AVAILABLE,
    and reconciles stuck call.
    """
    clock = SimClock(start=1000.0)
    provider = MockReaperProvider()
    reaper = Reaper(clock=clock, providers={"A": provider})

    agent_id = str(uuid.uuid4())
    call_id = str(uuid.uuid4())

    # Step 1: Simulate worker reserving agent with 30s TTL lease
    start_time = clock.now()
    ttl_expiry = start_time + timedelta(seconds=30)

    async with db_session_maker() as session:
        agent = Agent(
            id=agent_id,
            name="CrashedWorkerAgent",
            status="RESERVED",
            reserved_by="crashed_worker_1",
            reserved_until=ttl_expiry,
        )
        call = Call(
            id=call_id,
            agent_id=agent_id,
            provider="A",
            provider_call_id="prov_crash_1",
            state="INITIATED",
            reserved_by="crashed_worker_1",
            reserved_until=ttl_expiry,
        )
        session.add(agent)
        session.add(call)
        await session.commit()

    # Step 2: At t=15s (before TTL), reaper does not reclaim prematurely
    clock.advance(15.0)
    async with db_session_maker() as session:
        counts = await reaper.run_once(session)
        assert counts["agents_reclaimed"] == 0
        agent_mid = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one()
        assert agent_mid.status == "RESERVED"

    # Step 3: At t=35s (> TTL=30s), reaper runs:
    clock.advance(20.0)  # total 35s elapsed
    async with db_session_maker() as session:
        counts = await reaper.run_once(session)
        assert counts["agents_reclaimed"] == 1
        assert counts["calls_reconciled"] == 1

        agent_after = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one()
        assert agent_after.status == "AVAILABLE"
        assert agent_after.reserved_by is None
        assert agent_after.reserved_until is None

        call_after = (await session.execute(select(Call).where(Call.id == call_id))).scalar_one()
        assert call_after.state == "COMPLETED"


@pytest.mark.asyncio
async def test_heartbeat_stale_agent_flipped_to_offline(db_session_maker):
    """Failure Drill 3: Agent loses heartbeat (>60s) -> reaper flips to OFFLINE."""
    clock = SimClock(start=1000.0)
    reaper = Reaper(clock=clock)
    agent_id = str(uuid.uuid4())

    async with db_session_maker() as session:
        agent = Agent(
            id=agent_id,
            name="DisappearingAgent",
            status="AVAILABLE",
            last_heartbeat_at=clock.now() - timedelta(seconds=70),
        )
        session.add(agent)
        await session.commit()

    async with db_session_maker() as session:
        counts = await reaper.run_once(session)
        assert counts["agents_offlined"] == 1

        agent_after = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one()
        assert agent_after.status == "OFFLINE"
