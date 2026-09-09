from __future__ import annotations
import asyncio
import json
from typing import Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from app.config import settings
from app.db import async_session_factory
from app.api.routes import get_agent_stats, get_call_funnel, get_dial_decisions

ws_router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]):
        text_data = json.dumps(message)
        for connection in list(self.active_connections):
            try:
                await connection.send_text(text_data)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()


@ws_router.websocket("/ws/dashboard")
async def dashboard_websocket(websocket: WebSocket):
    # Auth verification via query param ?token=... or header
    token = websocket.query_params.get("token")
    if not token:
        # Check authorization header
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if token != settings.dashboard_token:
        # Unauthorized
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket)
    try:
        # Periodic push loop: push live agent stats, funnel, and pacing decisions every 1s
        while True:
            try:
                async with async_session_factory() as session:
                    agent_stats = await get_agent_stats(session)
                    funnel = await get_call_funnel(session)
                    decisions = await get_dial_decisions(limit=15, session=session)
            except Exception:
                agent_stats = {"AVAILABLE": 0, "CONNECTED": 0, "OFFLINE": 0}
                funnel = {"QUEUED": 0, "CONNECTED": 0, "COMPLETED": 0}
                decisions = []

            payload = {
                "type": "SNAPSHOT",
                "agents": agent_stats,
                "funnel": funnel,
                "decisions": decisions,
            }
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
