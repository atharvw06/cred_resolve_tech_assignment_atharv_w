from __future__ import annotations
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.api.dashboard_ws import ws_router

app = FastAPI(
    title="CredResolve SmartDialer API",
    version="0.1.0",
    description="Intelligent debt-recovery dialer with Safety Controller and dual progressive/predictive pacing.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe endpoint."""
    return {"status": "ok"}


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> str:
    """Prometheus-compatible metrics endpoint."""
    return (
        "# HELP dial_decisions_total Total dial decisions evaluated\n"
        "# TYPE dial_decisions_total counter\n"
        'dial_decisions_total{campaign="default",mode="PROGRESSIVE"} 0\n'
        "# HELP agent_state Current number of agents in each status\n"
        "# TYPE agent_state gauge\n"
        'agent_state{status="AVAILABLE"} 0\n'
        'agent_state{status="CONNECTED"} 0\n'
    )
