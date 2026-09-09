# SmartDialer — CredResolve Collections Dialer Prototype

A production-grade, progressive and predictive outbound dialer prototype with a mathematical **Safety Controller** firewall and deterministic progressive fallback for AI debt-recovery operations. Built for the CredResolve Hiring 2026 technical assignment.

---

## 🚀 Quickstart

### Option A: Docker Compose (Recommended for Staging/Production)
```bash
docker compose up --build -d
```
- API & Docs: http://localhost:8000/docs
- Live Metrics: http://localhost:8000/metrics
- React Dashboard: http://localhost:5173

### Option B: Local Developer Mode
```bash
# 1. Install dependencies
pip install -e .
cd dashboard && npm install && npm run build && cd ..

# 2. Run full pytest suite (FSM, Concurrency, Chaos, Property, Firewall)
python -m pytest -v

# 3. Run import firewall check
python -c "import importlinter.cli; importlinter.cli.lint_imports()"

# 4. Run deterministic simulation (Scenario A, seed 42)
python -m app.sim.runner --scenario A --seed 42 --duration 600 --agents 50

# 5. Run concurrency load test (8 workers, 1000 agents)
python scripts/load_test.py --workers 8 --agents 1000 --duration 60

# 6. Start API server & React Dashboard
uvicorn app.main:app --host 0.0.0.0 --port 8000
# In another terminal:
cd dashboard && npm run dev
```

---

## 🏛️ Architecture & System Invariants

The dialer strictly isolates speculative predictive estimation from outbound telephony placement through a **Safety Controller firewall**:

```
Campaign ──▶ Pacing Engine (Progressive / Predictive)
                 │
                 │ request_calls(n) (Firewall: Pacing CANNOT import providers)
                 ▼
          Safety Controller  (Recomputes A, R, C from DB; clamps to binomial bound)
                 │
                 │ approved_n
                 ▼
          Call Allocator   (Atomic SKIP LOCKED agent reservation)
                 │
                 ▼
          Telecom Provider (A / B) wrapped in CircuitBreaker
```

1. **Postgres Single Source of Truth:** No Redis, Kafka, or message brokers. Atomic agent reservations via `FOR UPDATE SKIP LOCKED`, transaction-scoped advisory locks (`pg_advisory_xact_lock`), and `LISTEN/NOTIFY`.
2. **Architectural Import Firewall:** Pacing modules are strictly forbidden from importing `app.providers.*`. Enforced via CI test `tests/test_import_firewall.py` and `import-linter`.
3. **Safety Controller Guarantee:** Recomputes active available agents ($A$), ringing calls ($R$), and connected calls ($C$) directly from the database on every tick. Clamps dials via closed-form 99th-percentile binomial upper bound.
4. **TTL Leases & Garbage Collection:** Every agent reservation, dial task, and claim holds a TTL lease. The background `Reaper` reclaims stranded resources and reconciles stuck calls.
5. **Deterministic Injected Time:** All domain algorithms, pacing loops, and simulations consume time through an injected `Clock` protocol.

Detailed diagrams, container interactions, and ADR narratives are documented in [ARCHITECTURE.md](file:///d:/CRED_RESOLVE/ARCHITECTURE.md).

---

## 📊 Technical Answers & Failure Drills

Comprehensive answers to all assignment questions, failure drills, 100→10k scale bottlenecks, and design reflections are documented in [ANSWERS.md](file:///d:/CRED_RESOLVE/ANSWERS.md):
- **Question 1:** Predictive utilization with progressive deterministic safety.
- **Question 2:** Bottleneck breakdown at 100, 1,000, and 10,000 agents.
- **Question 3:** Observed outcomes for all 5 failure drills (Worker crash, Provider outage, Agent drop, Duplicate events, Reordered events).
- **Question 4:** Candid reflection on the least-confident architectural component.

---

## 🧪 Test Suite Overview

| Test Module | Coverage | Invariant Validated |
|---|---|---|
| `tests/test_fsm.py` | Agent & Call state machines | Pure-Python, convergence on `COMPLETED`, idempotent terminal states |
| `tests/test_reservation_concurrency.py` | Multi-worker race conditions | `SKIP LOCKED` atomic mutual exclusion, zero double-reservations |
| `tests/test_circuit_breaker.py` | Provider outage handling | Automated trip on failure EWMA / 5 errors, `HALF_OPEN` probe recovery |
| `tests/test_event_chaos.py` | Telecom chaos & worker crashes | Out-of-order `COMPLETED, ANSWERED, RINGING` convergence, duplicate idempotency |
| `tests/test_progressive.py` | Progressive capacity bounds | 50 agents -> system never exceeds 50 dials at any tick |
| `tests/test_crash_drill.py` | Worker death & lease expiry | Reaper TTL recovery, zero stranded resources |
| `tests/test_safety_property.py` | 10,000 Hypothesis property states | Quadratic closed-form binomial safety inequality never violated |
| `tests/test_import_firewall.py` | Structural dependency boundary | Zero provider leakage into pacing packages |
| `tests/test_predictive.py` | Predictive pacing & AIMD | Proposal math, AIMD halving on abandonment, progressive cooldown |
| `tests/test_dashboard_api.py` | WebSocket & REST endpoints | Auth token validation, live snapshot generation |
