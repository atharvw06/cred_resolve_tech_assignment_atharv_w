#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "SMARTDIALER ONE-SHOT DEMO RUNNER"
echo "CredResolve Tech Assignment - Prototype Demonstration"
echo "=========================================================="

echo "[1/4] Running test suite..."
python -m pytest -v

echo "[2/4] Running Scenario A simulation (600s, Seed 42)..."
python -m app.sim.runner --scenario A --seed 42 --duration 600 --agents 50

echo "[3/4] Running Load Test (8 workers, 1000 agents)..."
python scripts/load_test.py --workers 8 --agents 1000 --duration 10

echo "[4/4] Starting FastAPI backend and Vite React dashboard..."
echo "To launch full stack via Docker Compose:"
echo "  docker compose up --build"
echo ""
echo "To launch standalone services locally:"
echo "  1. Backend:   uvicorn app.main:app --port 8000"
echo "  2. Worker:    python -m app.worker.pacing_worker"
echo "  3. Dashboard: cd dashboard && npm run dev (http://localhost:5173)"
echo "=========================================================="
echo "DEMO READY: See README.md for complete guide."
echo "=========================================================="
