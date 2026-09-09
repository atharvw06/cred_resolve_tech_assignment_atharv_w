from __future__ import annotations
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from app.domain.models import Base, Borrower, Campaign, Call
from app.providers.call_allocator import reserve_borrower

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
async def test_racing_10_workers_on_10_borrowers(async_db):
    """10 workers racing concurrently for 10 borrowers -> exactly 10 unique winners."""
    campaign_id = str(uuid.uuid4())
    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        for i in range(10):
            b = Borrower(
                id=str(uuid.uuid4()),
                campaign_id=campaign_id,
                phone=f"+91987654321{i}",
                priority=10 - i,
                call_count=0,
                max_attempts=3,
                suppressed=False,
            )
            session.add(b)
        await session.commit()

    results: list[dict | None] = []

    async def worker_task(worker_idx: int):
        async with async_db() as session:
            res = await reserve_borrower(session, campaign_id=campaign_id, worker_id=f"worker_{worker_idx}")
            results.append(res)

    await asyncio.gather(*[worker_task(i) for i in range(10)])

    claimed = [r for r in results if r is not None]
    assert len(claimed) == 10, f"Expected 10 claims, got {len(claimed)}"
    claimed_ids = [r["id"] for r in claimed]
    assert len(set(claimed_ids)) == 10, "Double-reservation detected among borrowers!"


@pytest.mark.asyncio
async def test_racing_50_workers_on_10_borrowers(async_db):
    """50 workers racing concurrently for 10 borrowers -> exactly 10 winners, 40 misses."""
    campaign_id = str(uuid.uuid4())
    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        for i in range(10):
            b = Borrower(
                id=str(uuid.uuid4()),
                campaign_id=campaign_id,
                phone=f"+91987654322{i}",
                priority=1,
                call_count=0,
                max_attempts=3,
                suppressed=False,
            )
            session.add(b)
        await session.commit()

    results: list[dict | None] = []

    async def worker_task(worker_idx: int):
        async with async_db() as session:
            res = await reserve_borrower(session, campaign_id=campaign_id, worker_id=f"worker_{worker_idx}")
            results.append(res)

    await asyncio.gather(*[worker_task(i) for i in range(50)])

    claimed = [r for r in results if r is not None]
    assert len(claimed) == 10
    claimed_ids = [r["id"] for r in claimed]
    assert len(set(claimed_ids)) == 10
    misses = [r for r in results if r is None]
    assert len(misses) == 40


@pytest.mark.asyncio
async def test_suppressed_borrower_never_claimed(async_db):
    """Borrower with suppressed=True must never be reserved."""
    campaign_id = str(uuid.uuid4())
    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        b = Borrower(
            id=str(uuid.uuid4()),
            campaign_id=campaign_id,
            phone="+919999999999",
            priority=100,  # Highest priority
            call_count=0,
            max_attempts=3,
            suppressed=True,  # Suppressed!
        )
        session.add(b)
        await session.commit()

    async with async_db() as session:
        res = await reserve_borrower(session, campaign_id=campaign_id, worker_id="worker_test")
        assert res is None, "Suppressed borrower was erroneously reserved!"


@pytest.mark.asyncio
async def test_max_attempts_exceeded_never_claimed(async_db):
    """Borrower with call_count >= max_attempts must never be reserved."""
    campaign_id = str(uuid.uuid4())
    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        b = Borrower(
            id=str(uuid.uuid4()),
            campaign_id=campaign_id,
            phone="+919888888888",
            priority=10,
            call_count=3,
            max_attempts=3,  # Reached limit
            suppressed=False,
        )
        session.add(b)
        await session.commit()

    async with async_db() as session:
        res = await reserve_borrower(session, campaign_id=campaign_id, worker_id="worker_test")
        assert res is None, "Borrower exceeding max_attempts was reserved!"


@pytest.mark.asyncio
async def test_active_call_exclusivity_prevents_simultaneous_call(async_db):
    """Borrower currently with an active RINGING call must not be reserved again."""
    campaign_id = str(uuid.uuid4())
    borrower_id = str(uuid.uuid4())
    async with async_db() as session:
        c = Campaign(id=campaign_id, name="Test Camp", mode="PROGRESSIVE", provider="A")
        session.add(c)
        b = Borrower(
            id=borrower_id,
            campaign_id=campaign_id,
            phone="+919777777777",
            priority=50,
            call_count=1,
            max_attempts=3,
            suppressed=False,
        )
        session.add(b)
        # Add active call
        active_call = Call(
            id=str(uuid.uuid4()),
            campaign_id=campaign_id,
            borrower_id=borrower_id,
            provider="A",
            state="RINGING",
        )
        session.add(active_call)
        await session.commit()

    async with async_db() as session:
        res = await reserve_borrower(session, campaign_id=campaign_id, worker_id="worker_test")
        assert res is None, "Borrower with active ringing call was reserved for a second simultaneous call!"
