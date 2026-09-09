from __future__ import annotations
import asyncio
import os
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.domain.models import Base, Agent, Campaign
from app.providers.call_allocator import reserve_agent

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


@pytest.fixture
async def db_session_maker():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    yield session_maker
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_racing_10_actors_on_10_agents(db_session_maker):
    """Spawn N=10 asyncio tasks racing on a pool of N=10 AVAILABLE agents -> exactly 10 succeed, 0 collisions."""
    pool_size = 10
    async with db_session_maker() as session:
        for i in range(pool_size):
            agent = Agent(
                id=str(uuid.uuid4()),
                name=f"Agent-{i}",
                status="AVAILABLE",
                last_call_ended_at=None,
            )
            session.add(agent)
        await session.commit()

    async def worker_claim(worker_idx: int):
        async with db_session_maker() as s:
            return await reserve_agent(s, worker_id=f"worker-{worker_idx}")

    # Launch 10 racing tasks concurrently
    results = await asyncio.gather(*(worker_claim(i) for i in range(pool_size)))
    successful = [r for r in results if r is not None]
    assert len(successful) == pool_size, f"Expected {pool_size} claims, got {len(successful)}"

    reserved_agent_ids = {r["id"] for r in successful}
    assert len(reserved_agent_ids) == pool_size, "Collision detected: duplicate agent reserved!"

    async with db_session_maker() as session:
        stmt = select(func.count()).select_from(Agent).where(Agent.status == "RESERVED")
        count_reserved = await session.scalar(stmt)
        assert count_reserved == pool_size


@pytest.mark.asyncio
async def test_racing_50_actors_on_10_agents(db_session_maker):
    """N=50 tasks on N=10 agents -> exactly 10 succeed, 40 get None."""
    pool_size = 10
    num_actors = 50

    async with db_session_maker() as session:
        for i in range(pool_size):
            agent = Agent(
                id=str(uuid.uuid4()),
                name=f"Agent-50-{i}",
                status="AVAILABLE",
                last_call_ended_at=None,
            )
            session.add(agent)
        await session.commit()

    async def worker_claim(worker_idx: int):
        async with db_session_maker() as s:
            return await reserve_agent(s, worker_id=f"worker-{worker_idx}")

    results = await asyncio.gather(*(worker_claim(i) for i in range(num_actors)))
    successful = [r for r in results if r is not None]
    failed = [r for r in results if r is None]

    assert len(successful) == pool_size, f"Expected {pool_size} successes, got {len(successful)}"
    assert len(failed) == (num_actors - pool_size), f"Expected {num_actors - pool_size} None, got {len(failed)}"

    reserved_agent_ids = {r["id"] for r in successful}
    assert len(reserved_agent_ids) == pool_size, "Collision detected: duplicate agent reserved!"

    async with db_session_maker() as session:
        stmt = select(func.count()).select_from(Agent).where(Agent.status == "RESERVED")
        count_reserved = await session.scalar(stmt)
        assert count_reserved == pool_size


@pytest.mark.asyncio
async def test_round_robin_fairness(db_session_maker):
    """Round-robin fairness: last_call_ended_at NULLS FIRST ensures uncalled agents picked first."""
    async with db_session_maker() as session:
        agent_called_recently = Agent(
            id=str(uuid.uuid4()),
            name="Agent-Recently-Called",
            status="AVAILABLE",
            last_call_ended_at=datetime.now(timezone.utc),
        )
        agent_never_called = Agent(
            id=str(uuid.uuid4()),
            name="Agent-Never-Called",
            status="AVAILABLE",
            last_call_ended_at=None,
        )
        session.add(agent_called_recently)
        session.add(agent_never_called)
        await session.commit()

    async with db_session_maker() as session:
        claimed = await reserve_agent(session, worker_id="worker-fairness")
        assert claimed is not None
        assert claimed["id"] == agent_never_called.id
        assert claimed["name"] == "Agent-Never-Called"
