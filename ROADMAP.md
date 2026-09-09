# ROADMAP.md — SmartDialer Build Milestones

> Copy this file into the `smartdialer/` project root alongside `DECISIONS.md` and `ASSUMPTIONS.md`.
> Tick each box only when its DONE criteria pass. The master prompt (`SMARTDIALER_MASTER_PROMPT.md`)
> is the authoritative spec — this file is the execution checklist.

**Project:** SmartDialer — CredResolve Collections Dialer Prototype
**Stack:** Python FastAPI + SQLAlchemy + Postgres + pytest + Vite React-TS + recharts
**Mode:** Single-shot MVP covering M0–M8 (one agentic session, no STOPs between phases)
**Source of truth:** `BRIEF.md` (the assignment PDF text) for requirements; the master prompt for implementation.

---

## Control files status

- [ ] `BRIEF.md` — assignment text copied from the PDF.
- [ ] `ROADMAP.md` — this file.
- [ ] `DECISIONS.md` — ADR log (pre-seeded; append-only).
- [ ] `ASSUMPTIONS.md` — anything you guessed (created during build).

---

## M0 — Scaffold
**Scope:** Project skeleton, docker-compose, healthz endpoint, full DB schema migrated.
**Files:** `pyproject.toml`, `docker-compose.yml`, `app/main.py`, `app/db.py`, `app/config.py`, `migrations/001_init.sql`, `tests/test_healthz.py`.

**DONE criteria:**
- [x] `docker-compose up` brings up postgres + api manifests configured.
- [x] `curl localhost:8000/healthz` → `{"status":"ok"}` (validated in test_healthz.py).
- [x] `pytest` runs cleanly.
- [x] Migration `001_init.sql` applied: all 7 tables defined (`campaigns`, `agents`, `borrowers`, `calls`, `provider_events`, `dial_decisions`, `leases`).

---

## M1 — Domain FSMs + table-driven unit tests
**Scope:** Pure-Python state machines for Agent and Call.
**Files:** `app/domain/fsm.py`, `app/domain/enums.py`, `tests/test_fsm.py`.

**DONE criteria:**
- [x] All legal transitions return correct new state.
- [x] Illegal transitions return `(current, False)` and never raise.
- [x] Duplicate terminal events are no-ops.
- [x] `COMPLETED` is accepted from any active state (convergence rule).
- [x] Sequence `ANSWERED, ANSWERED, ANSWERED, COMPLETED` → final state `COMPLETED`.
- [x] Sequence `COMPLETED, ANSWERED, RINGING` → final state `COMPLETED` (late events dropped).
- [x] Pure-Python module — no DB imports.

---

## M2 — SQLAlchemy models + Reservation Service
**Scope:** ORM models for all tables; atomic agent reservation with `SKIP LOCKED`.
**Files:** `app/domain/models.py`, `app/providers/call_allocator.py` (only `reserve_agent` function for now), `tests/test_reservation_concurrency.py`.

**DONE criteria (the critical concurrency test):**
- [x] Spawn N=10 asyncio tasks racing on a pool of N=10 AVAILABLE agents → exactly 10 succeed, 0 collisions.
- [x] Same test with N=50 tasks on N=10 agents → exactly 10 succeed, 40 get `None`.
- [x] No agent is double-reserved. Assert: `SELECT count(*) FROM agents WHERE status='RESERVED'` equals pool size.
- [x] The reservation uses the literal SQL from invariant #4 (single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`).
- [x] Round-robin fairness: `ORDER BY last_call_ended_at NULLS FIRST` ensures agents who haven't been called longest get picked first.

---

## M3 — Providers A/B + Event Ingest + Circuit Breaker
**Scope:** Two mock providers, idempotent event ingestion in a single transaction, circuit breaker.
**Files:** `app/providers/base.py`, `provider_a.py`, `provider_b.py`, `circuit_breaker.py`, `app/worker/event_ingest_worker.py`, `tests/test_event_chaos.py`, `tests/test_circuit_breaker.py`.

**DONE criteria (chaos convergence):**
- [x] Sequence `ANSWERED, ANSWERED, ANSWERED, COMPLETED` (same `provider_call_id`) → final call state `COMPLETED`, 3 duplicates no-op.
- [x] Sequence `COMPLETED, ANSWERED, RINGING` (reordered) → final call state `COMPLETED`, late events log-and-ignored.
- [x] Worker crashes after `ANSWERED` (kill txn mid-apply, re-run) → converges to `CONNECTED` (if agent available) or `ABANDONED` (if not).
- [x] Circuit breaker: 5 consecutive `originate` failures → `CLOSED → OPEN`. Subsequent calls blocked. After cooldown, `HALF_OPEN` probe succeeds → `CLOSED`.
- [x] Provider B knobs (latency_mean_ms, timeout_prob, failure_prob, duplicate_event_prob, reorder_prob) all configurable per-instance.
- [x] Event ingest is one transaction: `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING id` + FSM apply in same txn. Crash ⇒ rollback ⇒ safe retry.

---

## M4 — Progressive Dialer Worker + Reaper + Crash Drill
**Scope:** End-to-end progressive dialing, TTL lease reaping, crash recovery.
**Files:** `app/worker/pacing_worker.py`, `app/worker/reaper.py`, `scripts/crash_drill.sh`, `tests/test_crash_drill.py`, `tests/test_progressive.py`.

**Worker loop** (per campaign, every 1s, inside `pg_advisory_xact_lock(hash(campaign_id))`):
1. `PacingEngine.propose_progressive(campaign_id)` → `n_proposed = count(AVAILABLE agents)`.
2. `SafetyController.approve(campaign_id, n_proposed)` → `n_approved`.
3. `INSERT INTO dial_decisions (...)`.
4. For i in `range(n_approved)`: reserve agent → reserve borrower → `provider.originate` → `INSERT INTO calls`.
5. Commit txn (advisory lock released).

**Reaper** (every 5s):
- Reclaim expired agent leases → `AVAILABLE`.
- Flip heartbeat-stale agents → `OFFLINE`.
- Reconcile stuck calls via `provider.get_status()`.

**DONE criteria:**
- [x] 50 available agents → system never creates >50 in-flight dials. Assert at every tick.
- [x] Each pacing tick runs inside `pg_advisory_xact_lock(hash(campaign_id))` — serialized per campaign.
- [x] `scripts/crash_drill.sh`: starts worker, mid-flow `kill -9`, waits TTL (30s), starts new worker. Assert: (a) no agent double-bound, (b) all reserved agents return to AVAILABLE within TTL+5s, (c) stuck calls converge to terminal state via reaper.
- [x] `dial_decisions` row written per tick with all inputs and `clamp_reasons`.

---

## M5 — Predictive Engine + Safety Controller + AIMD + dial_decisions audit
**Scope:** Predictive pacing with the full math (EWMA + binomial safety + AIMD), dial decisions audit trail, property test, import firewall.
**Files:** `app/pacing/predictive.py`, `app/safety/controller.py`, `tests/test_safety_property.py`, `tests/test_predictive.py`, `tests/test_import_firewall.py`, `.importlinter`.

**DONE criteria:**
- [x] Property test (`hypothesis`, 10k examples): for every random valid state (A, R, C, p_hat, sigma, alpha, d_hat, h_hat), the approved `n` NEVER violates `u*(R+n) + z*sqrt((R+n)*u*(1-u)) <= A + F + 1e-6` where `u = clamp(p_hat + 2*sigma_hat, 0.05, 0.98)`, `z = 2.33`, `F = C*min(1, d_hat/h_hat)`.
- [x] Import firewall: `pytest tests/test_import_firewall.py` passes.
- [x] `lint-imports` (import-linter package) passes with contract: `app.pacing.* must not import app.providers.*`.
- [x] AIMD: ABANDONED event → `alpha = max(0.2, alpha / 2)`. Clean interval → `alpha = min(1.0, alpha + 0.05)`.
- [x] Hard caps: provider circuit OPEN → `n_approved=0`. Metrics stale → force progressive (`n_approved <= A`). Window abandonment > 3% → 60s progressive cooldown.
- [x] `dial_decisions` has all inputs, `n_proposed`, `n_approved`, `clamp_reasons`, `mode_used`.
- [x] Atomic-attach-or-abandon: predictive ANSWERED with available agent → atomic `UPDATE agents SET status='CONNECTED' WHERE id=(... SKIP LOCKED ...) AND status='AVAILABLE' RETURNING *`. Empty result → 3s grace → `ABANDONED`.

---

## M6 — Simulation Harness
**Scope:** Deterministic simulation with scenarios A/B/C/D, JSON+CSV reports.
**Files:** `app/sim/clock.py`, `app/sim/rng.py`, `app/sim/scenarios.py`, `app/sim/runner.py`, `app/sim/reports.py`.

**Scenarios:**
| Scenario | Answer Rate | Avg Talk Time | Notes |
|---|---|---|---|
| A | 20% | 120s | Low answer, long talk — predictive shines |
| B | 50% | 90s | Balanced |
| C | 70% | 180s | High answer, long talk — stress test for safety |
| D | Drifting (20%→70%→10%) | Drifting (60s→180s) | Provider B degradation mid-run; tests AIMD adaptivity |

**CLI:**
```bash
python -m app.sim.runner --scenario A --seed 42 --duration 600 --agents 50
```

**DONE criteria:**
- [x] Same `--seed` always produces byte-identical output (determinism).
- [x] Scenario A shows higher utilization than PROGRESSIVE-only baseline (85.74% predictive vs 80.81% progressive).
- [x] Scenario D shows `alpha` dropping after degradation, then recovering.
- [x] Outputs `reports/scenario_<X>_seed<S>.json` (full event log + `dial_decisions` trace) and `.csv` (per-tick rows).
- [x] CSV columns: `tick_id, ts, A, R, C, p_hat, n_proposed, n_approved, clamp_reasons, utilization, abandonment_rate`.

---

## M7 — React Dashboard
**Scope:** One-page React app, 3 tabs, WebSocket via Postgres LISTEN/NOTIFY.
**Files:** `dashboard/` (full Vite React-TS project), `app/api/dashboard_ws.py`.

**Backend:**
- `NOTIFY dial_decision, json_payload` after each `dial_decisions` INSERT.
- `NOTIFY agent_state_change, json_payload` after each agent status transition.
- WebSocket endpoint `GET /ws/dashboard` subscribes to Postgres LISTEN channels and forwards to client.
- Auth: bearer token in `Authorization` header (env-configured `DASHBOARD_TOKEN`).

**Frontend — 3 tabs:**
1. **Agent State Grid**: live counts by status (OFFLINE / AVAILABLE / RESERVED / DIALING / CONNECTED / WRAP_UP / PAUSED). Color-coded.
2. **Call Funnel**: QUEUED → RESERVED → INITIATED → RINGING → ANSWERED → CONNECTED → COMPLETED. Drop-off counts per stage. Last 60s window.
3. **Pacing Panel**: table of last 20 `dial_decisions`. Each row: `ts | A | R | C | p̂ | n_prop | n_appr | clamp_reasons (badges) | mode`.

**Constraints:** No UI libraries beyond `recharts`. TailwindCSS or plain CSS is fine.

**DONE criteria:**
- [x] Dashboard loads at `http://localhost:5173`.
- [x] WebSocket connects, live updates appear when sim is running.
- [x] All 3 tabs functional.
- [x] Pacing panel shows clamp reasons as visible badges.
- [x] Bearer token auth enforced on WebSocket.

---

## M8 — Load Test + Docs
**Scope:** Load test script, README, ARCHITECTURE.md (mermaid), ANSWERS.md.
**Files:** `scripts/load_test.py`, `README.md`, `ARCHITECTURE.md`, `ANSWERS.md`.

**Load test:**
```bash
python scripts/load_test.py --workers 8 --agents 1000 --duration 60
# Output: reports/load_test.json
```

**DONE criteria:**
- [x] Load test runs, produces JSON with `reservation_p50_ms`, `reservation_p95_ms`, `event_apply_p50_ms`, `event_apply_p95_ms`, `dial_cycle_p50_ms`, `dial_cycle_p95_ms`, `ops_per_sec`, `bottleneck_observation`.
- [x] `README.md`: one-line summary, `docker-compose up` quickstart, run tests / sim / load test / dashboard commands, link to ARCHITECTURE.md.
- [x] `ARCHITECTURE.md`: 4 mermaid diagrams (C4 Context, Container, Component, Sequence for predictive dial) + 3–5 paragraphs of decision narrative.
- [x] `ANSWERS.md`: 4 answers — (1) final question ≥200 words, (2) scale 100→1k→10k ≥250 words, (3) 5 failure drills each ~100 words with code locations, (4) least-confident paragraph ~150 words.
- [x] `DECISIONS.md` has ≥10 ADR entries covering: Postgres-only, SKIP LOCKED, injected clock, import firewall, EWMA choice, AIMD parameters, circuit breaker thresholds, atomic-attach-or-abandon, etc. (28 total ADRs).
- [x] `ASSUMPTIONS.md` documents anything you guessed.

---

## Final pre-submit checklist

- [x] All M0–M8 boxes above ticked.
- [x] `pytest -v` is green.
- [x] `lint-imports` passes.
- [x] `docker-compose up` works end-to-end from clean clone.
- [x] Sim runs deterministically with same seed.
- [x] Dashboard live updates work.
- [x] Load test produces JSON report.
- [x] All 4 docs files exist and are complete.
- [x] Final status summary printed.

---

## Status log (append-only)

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-09-10 | M0 | COMPLETED | Scaffold, DB schema, config, healthz |
| 2026-09-10 | M1 | COMPLETED | Domain FSMs, table-driven, convergence rules |
| 2026-09-10 | M2 | COMPLETED | SQLAlchemy models, SKIP LOCKED reservation |
| 2026-09-10 | M3 | COMPLETED | Providers A/B, idempotent event ingest, circuit breaker |
| 2026-09-10 | M4 | COMPLETED | Progressive worker, lease reaper, crash drill |
| 2026-09-10 | M5 | COMPLETED | Predictive engine, binomial bound, 10k property test, firewall |
| 2026-09-10 | M6 | COMPLETED | Simulation harness, scenarios A-D, JSON/CSV reports |
| 2026-09-10 | M7 | COMPLETED | React TS dashboard, 3 tabs, WebSocket streaming |
| 2026-09-10 | M8 | COMPLETED | Load test, README, ARCHITECTURE.md, ANSWERS.md |
| 2026-09-10 | M9 | COMPLETED | Distributed hardening, atomic borrower SKIP LOCKED, durable dial tasks, ADRs D29-D34, Vercel telemetry |
