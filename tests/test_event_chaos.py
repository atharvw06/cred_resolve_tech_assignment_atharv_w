from __future__ import annotations
import os
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.clock import SimClock
from app.domain.models import Agent, Base, Call, ProviderEvent
from app.providers.base import ProviderEvent as ProviderEventData
from app.worker.event_ingest_worker import ingest_provider_event

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


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
async def test_duplicate_answered_then_completed(db_session_maker):
    """Sequence ANSWERED x 3, COMPLETED -> final call state COMPLETED, duplicates no-op."""
    call_id = str(uuid.uuid4())
    prov_call_id = f"prov_{uuid.uuid4().hex[:8]}"

    async with db_session_maker() as session:
        call = Call(
            id=call_id,
            provider="A",
            provider_call_id=prov_call_id,
            state="RINGING",
        )
        session.add(call)
        await session.commit()

    # Event 1: First ANSWERED
    async with db_session_maker() as session:
        evt1 = ProviderEventData(
            event_id="evt_ans_1",
            provider_call_id=prov_call_id,
            event_type="ANSWERED",
            payload={"provider": "A"},
        )
        row_id, applied = await ingest_provider_event(session, evt1)
        assert applied is True
        assert row_id is not None

    # Event 2: Duplicate ANSWERED (same event_id)
    async with db_session_maker() as session:
        row_id2, applied2 = await ingest_provider_event(session, evt1)
        assert applied2 is False
        assert row_id2 is None

    # Event 3: Another duplicate ANSWERED with different event_id (simulating telecom resend)
    async with db_session_maker() as session:
        evt3 = ProviderEventData(
            event_id="evt_ans_3",
            provider_call_id=prov_call_id,
            event_type="ANSWERED",
            payload={"provider": "A"},
        )
        row_id3, applied3 = await ingest_provider_event(session, evt3)
        # Call is already ANSWERED, so FSM transition (ANSWERED, answer) is a no-op
        assert applied3 is False
        assert row_id3 is not None

    # Event 4: COMPLETED
    async with db_session_maker() as session:
        evt4 = ProviderEventData(
            event_id="evt_comp_4",
            provider_call_id=prov_call_id,
            event_type="COMPLETED",
            payload={"provider": "A"},
        )
        row_id4, applied4 = await ingest_provider_event(session, evt4)
        assert applied4 is True
        assert row_id4 is not None

    # Verify final call state in DB is COMPLETED
    async with db_session_maker() as session:
        stmt = select(Call).where(Call.id == call_id)
        saved_call = (await session.execute(stmt)).scalar_one()
        assert saved_call.state == "COMPLETED"


@pytest.mark.asyncio
async def test_reordered_completed_answered_ringing(db_session_maker):
    """Sequence COMPLETED, ANSWERED, RINGING (reordered) -> final state COMPLETED, late events dropped."""
    call_id = str(uuid.uuid4())
    prov_call_id = f"prov_{uuid.uuid4().hex[:8]}"

    async with db_session_maker() as session:
        call = Call(
            id=call_id,
            provider="B",
            provider_call_id=prov_call_id,
            state="INITIATED",
        )
        session.add(call)
        await session.commit()

    # Early COMPLETED arrives first
    async with db_session_maker() as session:
        evt_comp = ProviderEventData(
            event_id="evt_early_comp",
            provider_call_id=prov_call_id,
            event_type="COMPLETED",
            payload={"provider": "B"},
        )
        row_id, applied = await ingest_provider_event(session, evt_comp)
        assert applied is True
        assert row_id is not None

    # Late ANSWERED arrives
    async with db_session_maker() as session:
        evt_late_ans = ProviderEventData(
            event_id="evt_late_ans",
            provider_call_id=prov_call_id,
            event_type="ANSWERED",
            payload={"provider": "B"},
        )
        row_id2, applied2 = await ingest_provider_event(session, evt_late_ans)
        assert applied2 is False
        assert row_id2 is not None  # Event logged, but transition dropped

    # Late RINGING arrives
    async with db_session_maker() as session:
        evt_late_ring = ProviderEventData(
            event_id="evt_late_ring",
            provider_call_id=prov_call_id,
            event_type="RINGING",
            payload={"provider": "B"},
        )
        row_id3, applied3 = await ingest_provider_event(session, evt_late_ring)
        assert applied3 is False
        assert row_id3 is not None  # Event logged, transition dropped

    # Verify final call state remains COMPLETED
    async with db_session_maker() as session:
        stmt = select(Call).where(Call.id == call_id)
        saved_call = (await session.execute(stmt)).scalar_one()
        assert saved_call.state == "COMPLETED"


@pytest.mark.asyncio
async def test_worker_crash_recovery_after_answered(db_session_maker):
    """
    Worker crashes after ANSWERED (simulated by rolling back mid-transaction or interrupted worker).
    On rerun / retry with available agent -> converges to CONNECTED.
    """
    call_id = str(uuid.uuid4())
    prov_call_id = f"prov_{uuid.uuid4().hex[:8]}"
    agent_id = str(uuid.uuid4())

    async with db_session_maker() as session:
        agent = Agent(id=agent_id, name="TestAgent", status="AVAILABLE")
        call = Call(id=call_id, provider="A", provider_call_id=prov_call_id, state="RINGING")
        session.add(agent)
        session.add(call)
        await session.commit()

    # Simulate crash: transaction aborted/rolled back
    async with db_session_maker() as session:
        # Worker starts processing but crashes before committing
        call = (await session.execute(select(Call).where(Call.id == call_id))).scalar_one()
        call.state = "ANSWERED"
        await session.rollback()

    # Re-run after crash: event is safely re-applied
    async with db_session_maker() as session:
        evt = ProviderEventData(
            event_id="evt_crash_retry",
            provider_call_id=prov_call_id,
            event_type="ANSWERED",
            payload={"provider": "A"},
        )
        row_id, applied = await ingest_provider_event(session, evt)
        assert applied is True
        assert row_id is not None

    # Call converged to CONNECTED because agent was available for atomic attach
    async with db_session_maker() as session:
        saved_call = (await session.execute(select(Call).where(Call.id == call_id))).scalar_one()
        assert saved_call.state == "CONNECTED"
        assert saved_call.agent_id == agent_id
