from __future__ import annotations
import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from app.config import settings
from app.main import app


from app.db import get_db
from app.domain.models import Base
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def override_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _get_test_db():
        async with session_maker() as session:
            yield session

    app.dependency_overrides[get_db] = _get_test_db
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


def test_rest_dashboard_endpoints(override_db):
    """Verify REST endpoints for agent stats, call funnel, and dial decisions."""
    client = TestClient(app)

    res_health = client.get("/healthz")
    assert res_health.status_code == 200

    res_stats = client.get("/api/agents/stats")
    assert res_stats.status_code == 200
    data = res_stats.json()
    assert "AVAILABLE" in data
    assert "CONNECTED" in data

    res_funnel = client.get("/api/calls/funnel")
    assert res_funnel.status_code == 200
    funnel_data = res_funnel.json()
    assert "QUEUED" in funnel_data
    assert "COMPLETED" in funnel_data

    res_decisions = client.get("/api/dial_decisions")
    assert res_decisions.status_code == 200
    assert isinstance(res_decisions.json(), list)


def test_websocket_unauthorized_token_rejected():
    """WebSocket connection with invalid or missing token is rejected."""
    client = TestClient(app)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/dashboard?token=wrong-token") as ws:
            ws.receive_text()


def test_websocket_authorized_token_accepted():
    """WebSocket connection with valid token is accepted and receives snapshot frames."""
    client = TestClient(app)
    token = settings.dashboard_token
    with client.websocket_connect(f"/ws/dashboard?token={token}") as ws:
        frame = ws.receive_json()
        assert frame["type"] == "SNAPSHOT"
        assert "agents" in frame
        assert "funnel" in frame
        assert "decisions" in frame
        ws.close()
