from __future__ import annotations
import os
import uuid
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.clock import SimClock
from app.domain.models import Agent, Base, Borrower, Call, Campaign, DialDecision
from app.providers.base import CallStatus, OriginateRequest, OriginateResult
from app.worker.pacing_worker import PacingWorker

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


class InstantMockProvider:
    name = "A"

    async def originate(self, req: OriginateRequest) -> OriginateResult:
        return OriginateResult(ok=True, provider_call_id=f"prov_mock_{uuid.uuid4().hex[:8]}")

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
async def test_progressive_dialing_50_agents_never_exceeds_capacity(db_session_maker):
    """50 available agents -> system never creates > 50 dials in flight at any tick."""
    clock = SimClock(start=1000.0)
    mock_provider = InstantMockProvider()
    worker = PacingWorker(clock=clock, providers={"A": mock_provider})

    campaign_id = str(uuid.uuid4())
    num_agents = 50
    num_borrowers = 100

    async with db_session_maker() as session:
        # Create campaign
        camp = Campaign(
            id=campaign_id,
            name="Collections Campaign 50",
            mode="PROGRESSIVE",
            provider="A",
        )
        session.add(camp)

        # Seed 50 agents
        for i in range(num_agents):
            agent = Agent(
                id=str(uuid.uuid4()),
                campaign_id=campaign_id,
                name=f"Agent-{i}",
                status="AVAILABLE",
            )
            session.add(agent)

        # Seed 100 borrowers
        for i in range(num_borrowers):
            borrower = Borrower(
                id=str(uuid.uuid4()),
                campaign_id=campaign_id,
                phone=f"+9198765432{i:02d}",
                priority=1,
            )
            session.add(borrower)

        await session.commit()

    # Tick 1: all 50 available agents should be dialed
    async with db_session_maker() as session:
        result = await worker.tick_campaign(campaign_id, session)
        assert result["n_proposed"] == 50
        assert result["n_approved"] == 50
        assert result["dials_placed"] == 50

        # In-flight count verification
        in_flight = await session.scalar(
            select(func.count()).select_from(Call).where(Call.state.in_(["INITIATED", "RINGING"]))
        )
        assert in_flight <= 50
        assert in_flight == 50

    # Tick 2: all agents are now DIALING, 0 available -> 0 dials placed
    async with db_session_maker() as session:
        result2 = await worker.tick_campaign(campaign_id, session)
        assert result2["n_proposed"] == 0
        assert result2["n_approved"] == 0
        assert result2["dials_placed"] == 0

        in_flight2 = await session.scalar(
            select(func.count()).select_from(Call).where(Call.state.in_(["INITIATED", "RINGING"]))
        )
        assert in_flight2 <= 50

        # Dial decision row audit verification
        decisions = (await session.execute(select(DialDecision).where(DialDecision.campaign_id == campaign_id))).scalars().all()
        assert len(decisions) == 2
        assert decisions[0].tick_id == 1
        assert decisions[0].agents_available == 50
        assert decisions[0].n_approved == 50
        assert decisions[1].tick_id == 2
        assert decisions[1].agents_available == 0
        assert decisions[1].n_approved == 0
