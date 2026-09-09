# ⚡ CredResolve SmartDialer — Mission-Critical Collections Outbound Dialer

[![CI / Test Suite](https://img.shields.io/badge/Tests-38%20Passed-10b981?style=flat-square&logo=pytest)](file:///d:/CRED_RESOLVE/tests)
[![Import Firewall](https://img.shields.io/badge/Import%20Firewall-1%20Kept%20%2F%200%20Broken-6366f1?style=flat-square)](file:///d:/CRED_RESOLVE/.importlinter)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Single%20Source%20of%20Truth-38bdf8?style=flat-square&logo=postgresql)](file:///d:/CRED_RESOLVE/migrations)
[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12%20%7C%203.14-f59e0b?style=flat-square&logo=python)](file:///d:/CRED_RESOLVE/pyproject.toml)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-06b6d4?style=flat-square&logo=fastapi)](file:///d:/CRED_RESOLVE/app/main.py)
[![React TS](https://img.shields.io/badge/Frontend-Vite%20%7C%20React%20%7C%20TS-a855f7?style=flat-square&logo=react)](file:///d:/CRED_RESOLVE/dashboard)
[![Vercel Ready](https://img.shields.io/badge/Deployment-Vercel%20Optimized-000000?style=flat-square&logo=vercel)](https://vercel.com)

> **A production-grade, progressive and predictive outbound dialer designed for AI debt-recovery operations.**
> Built strictly with **PostgreSQL as the single source of truth**, featuring an independent **Mathematical Safety Controller firewall** (closed-form quadratic binomial bound), atomic resource allocation via `FOR UPDATE SKIP LOCKED`, decoupled durable dial-task delivery, and resilient telecom chaos recovery.

---

## 📑 Table of Contents
- [Executive Overview](#-executive-overview)
- [Architecture & Invariant Guarantees](#-architecture--invariant-guarantees)
- [System Dataflow & Decoupled Task Pipeline](#-system-dataflow--decoupled-task-pipeline)
- [Quickstart: Deploy to Vercel (Instant Cloud Preview)](#-quickstart-deploy-to-vercel-instant-cloud-preview)
- [Local Developer Setup & Verification](#-local-developer-setup--verification)
- [Comprehensive Test Suite (38 Passed)](#-comprehensive-test-suite-38-passed)
- [Technical Answers & Failure Drill Summary](#-technical-answers--failure-drill-summary)
- [Documentation Index](#-documentation-index)

---

## 🎯 Executive Overview

In credit collections, agent idle time wastes operational payroll, while unhandled debtor connects that result in abandoned calls violate consumer protection regulations. SmartDialer reconciles these competing tensions:

1. **Deterministic Progressive Dialing (1:1)**: Guarantees that the system never dials more calls than currently available, eligible recovery agents.
2. **Adaptive Predictive Pacing (Alpha AIMD)**: Maximizes agent occupancy ($U_{\text{target}}=75\text{--}85\%$) by predicting future capacity based on call answer rates ($\hat{p}$) and average handle duration ($\hat{h}$).
3. **Independent Safety Controller Firewall**: An unbypassable mathematical gatekeeper that recalculates available agents ($A$), ringing calls ($R$), and active conversations ($C$) directly from PostgreSQL, clamping proposals to the root of a 99th-percentile quadratic binomial inequality ($z=2.33$):
   $$u \cdot (R + n) + z\sqrt{(R + n) \cdot u \cdot (1 - u)} \le A + F$$
4. **PostgreSQL-Centric Reliability**: No Kafka, Redis, or auxiliary broker dependencies. Uses `FOR UPDATE SKIP LOCKED` for atomic agent and borrower reservations, transaction-scoped advisory locks (`pg_advisory_xact_lock`), durable `dial_tasks`, and TTL leases reaped by background garbage collectors.

---

## 🏛️ Architecture & Invariant Guarantees

```
Campaign Advisory Lock (hash(id))
            │
            ▼
┌───────────────────────┐
│ Pacing Proposal Engine│  (Progressive: n = A  |  Predictive: n = ⌊α · (A+F) / p̂⌋)
└───────────┬───────────┘
            │ request_calls(n)  [Enforced Import Boundary: Pacing CANNOT touch Providers]
            ▼
┌───────────────────────┐
│   Safety Controller   │  Recomputes A, R, C, F from DB; queries 15m rolling abandonment;
│       Firewall        │  Clamps n via closed-form quadratic binomial bound.
└───────────┬───────────┘
            │ approved_n
            ▼
┌───────────────────────┐
│   Durable DialTask    │  Persists DialDecision and creates n durable DialTasks with
│       Creation        │  stable idempotency keys. Commits in < 2ms (Releases Advisory Lock).
└───────────┬───────────┘
            │
            ▼ (Decoupled Task Pipeline)
┌───────────────────────┐
│   DialTaskWorker      │  1. Claims DialTask via SKIP LOCKED.
│   (Delivery Worker)   │  2. Claims Agent via SKIP LOCKED (heartbeat + fairness order).
│                       │  3. Claims Borrower via SKIP LOCKED (suppression + retry checks).
│                       │  4. Calls provider.originate OUTSIDE long database transactions!
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│   Telecom Provider    │  Wrapped in CircuitBreaker (trips to OPEN on 5 errors or EWMA > 0.3).
│    (Provider A / B)   │  Emits events: RINGING, ANSWERED, COMPLETED, FAILED.
└───────────────────────┘
```

### Core Invariant Guarantees:
1. **Zero Double-Reservations**: Two concurrent workers racing for the same agent or borrower always yield exactly 1 winner and 0 collisions via `FOR UPDATE SKIP LOCKED`.
2. **Decoupled Telecom Boundary**: Remote provider latency never blocks campaign decision transactions or holds agent row locks.
3. **Effectively-Once Event Convergence**: Pure-Python FSMs guarantee that duplicate events (`ANSWERED` $\times 3$) and out-of-order events (`COMPLETED`, `ANSWERED`, `RINGING`) converge deterministically without raising or corrupting state.
4. **Self-Healing TTL Reaper**: Worker crashes during call setup or agent dropouts leave TTL leases that are automatically reaped into `AVAILABLE` or `OFFLINE` within 30 seconds.
5. **Architectural Import Firewall**: Pacing modules are forbidden from importing provider clients. Verified by `import-linter` in CI.

---

## 🌐 Quickstart: Deploy to Vercel (Instant Cloud Preview)

The React Mission Control Dashboard is optimized for zero-config Vercel deployment and features an embedded **Interactive Client Simulation Engine**. When deployed on Vercel without a local Python daemon, the dashboard automatically streams simulated telemetry, allowing immediate live interaction.

1. Navigate to **[vercel.com/new](https://vercel.com/new)** and select `atharvw06/CRED_RESOLVE_Tech_Assignment_Atharv_W`.
2. Configure settings (Automatic via [vercel.json](file:///d:/CRED_RESOLVE/vercel.json)):
   - **Framework Preset**: `Vite`
   - **Root Directory**: `dashboard` (or leave root `./`)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Click **Deploy**. Your dashboard is live at `https://<your-project>.vercel.app` in < 45 seconds!

### Live In-Browser Capabilities:
- **Scenario Controls**: Toggle between **Scenario A** (Nominal 20%), **Scenario B** (50% Spike), **Scenario C** (70% Stress), and **Scenario D** (Carrier B Drift Chaos).
- **Pacing Engine Mode**: Switch between `PREDICTIVE` (AIMD + Binomial Bound) and `PROGRESSIVE` (Deterministic 1:1).
- **Workforce Management**: Switch between **Sortable Agent Table** (search, status filters, AHT, occupancy, warnings) and **Visual Grid**.
- **Inspect Math 🔍**: Open the interactive safety modal to inspect the exact quadratic binomial formula and live parameters evaluated by the controller.
- **Safe Operations**: Test the destructive "Reset Pool" confirmation modal requiring operator reasons and logging to the audit trail.

---

## 💻 Local Developer Setup & Verification

### Option A: Docker Compose (Full Containerized Stack)
```bash
docker compose up --build -d
```
- **React Mission Control Dashboard**: http://localhost:5173
- **FastAPI Documentation & Swagger UI**: http://localhost:8000/docs
- **Prometheus Metrics**: http://localhost:8000/metrics
- **Health Endpoint**: http://localhost:8000/healthz

---

### Option B: Local Development Mode (Python + Node.js)

```bash
# 1. Clone repository
git clone https://github.com/atharvw06/CRED_RESOLVE_Tech_Assignment_Atharv_W.git
cd CRED_RESOLVE_Tech_Assignment_Atharv_W

# 2. Python Environment Setup (Python 3.11+)
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -e .

# 3. Frontend Setup (Node 18+)
cd dashboard
npm install
npm run build
cd ..

# 4. Run Pytest Suite (38 Tests Passed in ~11s)
python -m pytest -v

# 5. Verify Architectural Import Firewall Boundary
python -c "import importlinter.cli; importlinter.cli.lint_imports()"

# 6. Run Deterministic Simulation (Scenario A, seed 42)
python -m app.sim.runner --scenario A --seed 42 --duration 600 --agents 50

# 7. Run High-Concurrency Load Test (8 worker threads, 1,000 agents)
python scripts/load_test.py --workers 8 --agents 1000 --duration 60

# 8. Launch Services Locally
# Terminal 1 (FastAPI Backend + WebSocket Stream):
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 (React Vite Dashboard):
cd dashboard
npm run dev
# Open http://localhost:5173
```

---

## 🧪 Comprehensive Test Suite (38 Passed)

All 38 automated tests pass with 0 failures, validating mathematical safety bounds, concurrency races, and fault tolerance:

| Test Suite Module | Tests | Verified System Invariant |
|---|---|---|
| `tests/test_borrower_concurrency.py` | 5 | 10 & 50 worker races via `SKIP LOCKED`, suppression checks, retry backoffs, active call exclusivity |
| `tests/test_durable_dial_task.py` | 2 | Multi-worker task claims, zero double delivery, decoupled provider execution |
| `tests/test_reservation_concurrency.py` | 3 | Atomic agent reservations via `FOR UPDATE SKIP LOCKED`, round-robin fairness ordering |
| `tests/test_safety_property.py` | 1 | 10,000 random valid operational states via Hypothesis; closed-form binomial inequality never violated |
| `tests/test_circuit_breaker.py` | 2 | Carrier outages trip to `OPEN` after 5 failures or EWMA > 0.3; single-call probe in `HALF_OPEN` |
| `tests/test_event_chaos.py` | 3 | Duplicate `ANSWERED`, out-of-order `COMPLETED, ANSWERED, RINGING`, crash recovery mid-setup |
| `tests/test_crash_drill.py` | 2 | Worker death recovery via Reaper TTL leases; stale agent heartbeat flipped to `OFFLINE` |
| `tests/test_fsm.py` | 9 | Pure-Python state machines, convergence on `COMPLETED`, idempotent terminal states |
| `tests/test_progressive.py` | 1 | 50 agents -> system never exceeds 50 concurrent dials at any tick |
| `tests/test_predictive.py` | 5 | Proposal formula, AIMD halving on abandonment, additive slow ramp, safety clamps |
| `tests/test_import_firewall.py` | 1 | Zero provider client leakage into pacing packages (1 kept, 0 broken) |
| `tests/test_dashboard_api.py` | 3 | REST stats endpoints, WebSocket query token auth, unauthorized rejection |
| `tests/test_healthz.py` | 1 | Liveness probe HTTP 200 response |

---

## 📊 Technical Answers & Failure Drill Summary

Comprehensive answers to all assignment questions and failure drills are documented in [ANSWERS.md](file:///d:/CRED_RESOLVE/ANSWERS.md):

1. **Utilization vs. Safety Trade-Off**: Dual-mode engine where Predictive proposes speculatively while the Safety Controller strictly bounds dials based on the 99th-percentile quadratic binomial root.
2. **100 → 1,000 → 10,000 Agent Bottleneck Breakdown**:
   - **100 agents**: Zero contention; PostgreSQL operates under 2% CPU.
   - **1,000 agents**: Agent table write contention mitigated by partial index `WHERE status='AVAILABLE'` and round-robin tie-breaking.
   - **10,000 agents**: Connection pool saturation and transaction serialization mitigated by partitioned campaigns, connection pooling (PgBouncer), and maintained counters.
3. **Observed Outcomes in 5 Failure Drills**:
   - **Worker Crash**: Stranded agent/borrower leases reclaimed by Reaper within 30 seconds. Zero orphaned calls.
   - **Provider Outage**: Circuit breaker trips to `OPEN` within 5 failures; Safety Controller clamps new dials to 0.
   - **Agent Availability Drop**: Safety Controller recomputes $A$ directly from DB every tick; immediately adapts dial cap.
   - **Duplicate Events**: Idempotent state application; subsequent `ANSWERED` events return `(current, False)` without state regression.
   - **Reordered Events**: Convergence rule ensures `COMPLETED` transitions call to terminal state; late `ANSWERED` or `RINGING` events are log-and-ignored.
4. **Architectural Reflection**: Candid discussion of EWMA answer rate lag during sudden regime shifts, compensated by aggressive AIMD multiplicative decrease ($\alpha \gets \alpha / 2$).

---

## 📚 Documentation Index

- [ARCHITECTURE.md](file:///d:/CRED_RESOLVE/ARCHITECTURE.md): Architectural topology, 4 Mermaid sequence diagrams, container interactions, and failure mode analysis.
- [ANSWERS.md](file:///d:/CRED_RESOLVE/ANSWERS.md): Complete written answers to all assignment evaluation questions and scale analysis.
- [DECISIONS.md](file:///d:/CRED_RESOLVE/DECISIONS.md): Complete append-only Architectural Decision Records log (ADRs D1–D34).
- [TRACEABILITY_MATRIX.md](file:///d:/CRED_RESOLVE/TRACEABILITY_MATRIX.md): Comprehensive traceability matrix classifying every brief requirement against executable code and test evidence.
- [ROADMAP.md](file:///d:/CRED_RESOLVE/ROADMAP.md): Milestone progress log from M0 through M9 hardening.
- [ASSUMPTIONS.md](file:///d:/CRED_RESOLVE/ASSUMPTIONS.md): Explicit documentation of domain thresholds, lease timeouts, and circuit breaker constants.

---

<div align="center">
  <sub>Built with precision for the CredResolve Tech Assignment 2026. Codebase verified, fully tested, and ready for submission.</sub>
</div>
