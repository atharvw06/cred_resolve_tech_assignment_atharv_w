from __future__ import annotations
import asyncio
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from app.clock import SimClock
from app.domain.models import Base, Agent, Borrower, Campaign, DialTask
from app.domain.enums import DialTaskState
from app.providers.provider_a import ProviderA
from app.worker.dial_task_worker import DialTaskWorker

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    yield async_session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_racing_workers_claim_dial_tasks_no_duplicates(async_db):
    """10 workers racing to claim 5 DialTasks: exactly 5 winners, 5 unique tasks claimed."""
    campaign_id = str(uuid.uuid4())
    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        for i in range(5):
            task = DialTask(
                id=str(uuid.uuid4()),
                campaign_id=campaign_id,
                idempotency_key=f"task_key_{i}",
                state="PENDING",
                provider="A",
            )
            session.add(task)
        await session.commit()

    results: list[dict | None] = []

    async def worker_task(worker_idx: int):
        worker = DialTaskWorker(worker_id=f"worker_{worker_idx}")
        async with async_db() as session:
            res = await worker.claim_task(session, campaign_id=campaign_id)
            results.append(res)

    await asyncio.gather(*[worker_task(i) for i in range(10)])

    claimed = [r for r in results if r is not None]
    assert len(claimed) == 5, f"Expected 5 tasks claimed, got {len(claimed)}"
    claimed_ids = [r["id"] for r in claimed]
    assert len(set(claimed_ids)) == 5, "Double-claim detected on dial tasks!"


@pytest.mark.asyncio
async def test_dial_task_delivery_lifecycle(async_db):
    """Test full task delivery: claim -> reserve agent/borrower -> dispatch call."""
    clock = SimClock(1700000000.0)
    prov = ProviderA(clock=clock)
    worker = DialTaskWorker(worker_id="delivery_w1", clock=clock, providers={"A": prov})

    campaign_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())
    agent_id = str(uuid.uuid4())
    borrower_id = str(uuid.uuid4())

    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        ag = Agent(id=agent_id, campaign_id=campaign_id, name="Agent 01", status="AVAILABLE")
        session.add(ag)
        b = Borrower(id=borrower_id, campaign_id=campaign_id, phone="+919876543210", priority=1)
        session.add(b)
        task = DialTask(
            id=task_id,
            campaign_id=campaign_id,
            idempotency_key="idemp_123",
            state="PENDING",
            provider="A",
        )
        session.add(task)
        await session.commit()

    async with async_db() as session:
        claim = await worker.claim_task(session, campaign_id=campaign_id)
        assert claim is not None
        assert claim["id"] == task_id
        assert claim["state"] == "PROCESSING"

        call_id = await worker.execute_task(claim, session)
        assert call_id is not None

        # Verify DB states
        db_task = await session.get(DialTask, task_id)
        assert db_task.state == "DISPATCHED"
        assert db_task.call_id == call_id

        db_agent = await session.get(Agent, agent_id)
        assert db_agent.status == "DIALING"
