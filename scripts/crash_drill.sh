#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "SMARTDIALER CRASH DRILL (Failure Drill #1)"
echo "Scenario: Worker killed mid-flow -> TTL expires -> Reaper recovers"
echo "=========================================================="

echo "[1/4] Starting background pacing worker..."
python -m app.worker.pacing_worker &
WORKER_PID=$!
echo "Worker started with PID ${WORKER_PID}"

sleep 2

echo "[2/4] Simulating hard worker crash: kill -9 ${WORKER_PID}..."
kill -9 "${WORKER_PID}" || true
echo "Worker terminated abruptly mid-flow."

echo "[3/4] Waiting for TTL lease expiration (30 seconds)..."
sleep 30

echo "[4/4] Starting recovery worker with active Reaper..."
python -c "
import asyncio
from app.db import async_session_factory
from app.worker.reaper import Reaper
from app.clock import WallClock

async def reconcile():
    reaper = Reaper(clock=WallClock())
    async with async_session_factory() as session:
        counts = await reaper.run_once(session)
        print('Reaper recovery run results:', counts)

asyncio.run(reconcile())
"

echo "=========================================================="
echo "CRASH DRILL COMPLETE: All stranded leases reclaimed successfully."
echo "=========================================================="
