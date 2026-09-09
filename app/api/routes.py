from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.db import get_db
from app.domain.models import Agent, Call, Campaign, DialDecision

router = APIRouter(prefix="/api", tags=["dashboard"])


class HeartbeatRequest(BaseModel):
    agent_id: str


class CampaignCreateRequest(BaseModel):
    name: str
    mode: str = "PREDICTIVE"
    provider: str = "A"
    alpha: float = 0.5


def verify_token_header(token: str | None = None) -> bool:
    expected = settings.dashboard_token
    if token and token == expected:
        return True
    return False


@router.get("/campaigns")
async def list_campaigns(session: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    res = await session.execute(select(Campaign))
    camps = res.scalars().all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "mode": c.mode,
            "provider": c.provider,
            "alpha": c.alpha,
            "p_hat": c.p_hat,
            "active": c.active,
        }
        for c in camps
    ]


@router.post("/campaigns")
async def create_campaign(req: CampaignCreateRequest, session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    c = Campaign(name=req.name, mode=req.mode, provider=req.provider, alpha=req.alpha)
    session.add(c)
    await session.commit()
    return {"id": c.id, "name": c.name, "mode": c.mode}


@router.get("/agents/stats")
async def get_agent_stats(session: AsyncSession = Depends(get_db)) -> dict[str, int]:
    """Return count of agents by status."""
    res = await session.execute(select(Agent.status, func.count()).group_by(Agent.status))
    counts = {
        "OFFLINE": 0,
        "AVAILABLE": 0,
        "RESERVED": 0,
        "DIALING": 0,
        "CONNECTED": 0,
        "WRAP_UP": 0,
        "PAUSED": 0,
    }
    for st, cnt in res.all():
        if st in counts:
            counts[st] = cnt
    return counts


@router.post("/agents/heartbeat")
async def agent_heartbeat(req: HeartbeatRequest, session: AsyncSession = Depends(get_db)) -> dict[str, str]:
    agent = await session.get(Agent, req.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.last_heartbeat_at = datetime.now(timezone.utc)
    await session.commit()
    return {"status": "ok"}


@router.get("/calls/funnel")
async def get_call_funnel(session: AsyncSession = Depends(get_db)) -> dict[str, int]:
    """Return funnel counts of calls per state."""
    res = await session.execute(select(Call.state, func.count()).group_by(Call.state))
    funnel = {
        "QUEUED": 0,
        "RESERVED": 0,
        "INITIATED": 0,
        "RINGING": 0,
        "ANSWERED": 0,
        "CONNECTED": 0,
        "COMPLETED": 0,
        "FAILED": 0,
        "CANCELLED": 0,
        "ABANDONED": 0,
    }
    for st, cnt in res.all():
        if st in funnel:
            funnel[st] = cnt
    return funnel


@router.get("/dial_decisions")
async def get_dial_decisions(
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return last N dial decision audit logs for the Pacing Panel."""
    stmt = select(DialDecision).order_by(desc(DialDecision.decided_at)).limit(limit)
    res = await session.execute(stmt)
    decisions = res.scalars().all()
    return [
        {
            "id": d.id,
            "campaign_id": d.campaign_id,
            "tick_id": d.tick_id,
            "decided_at": d.decided_at.isoformat() if d.decided_at else "",
            "A": d.agents_available,
            "R": d.calls_initiated_or_ringing,
            "C": d.calls_answered_or_connected,
            "p_hat": round(d.p_hat, 4),
            "d_hat": round(d.d_hat, 2),
            "h_hat": round(d.h_hat, 2),
            "f_available": round(d.f_available, 2),
            "alpha": round(d.alpha, 4),
            "provider_circuit": d.provider_circuit,
            "n_proposed": d.n_proposed,
            "n_approved": d.n_approved,
            "clamp_reasons": d.clamp_reasons,
            "mode_used": d.mode_used,
        }
        for d in decisions
    ]
