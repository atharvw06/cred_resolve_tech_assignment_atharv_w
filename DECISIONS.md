# DECISIONS.md — Architecture Decision Records

> Append-only log. Every non-obvious choice gets one line:
> `D<seq>: <decision> — because <reason> — cost: <what it makes harder>`
>
> Pre-seeded with the key decisions encoded in the master prompt.
> Add new decisions as you build. Never delete or edit existing entries.

---

## Pre-seeded decisions (from the master prompt invariants)

D1: Postgres is the single source of truth — because `SKIP LOCKED` + advisory locks + transactions give exactly-once state transitions, `LISTEN/NOTIFY` covers the dashboard, and a single DB keeps operational complexity minimal for a prototype — cost: write throughput becomes the scaling bottleneck at ~10k agents (mitigated by maintained counters, batched commits, partitioning — see ANSWERS.md §2).

D2: No Redis, no Kafka, no message broker — because the assignment explicitly tests whether you can resist "add tech because it sounds impressive"; Postgres alone solves all prototype requirements — cost: at very high write throughput you may need an outbox→queue pattern (last resort, not first move).

D3: Provider clients are importable ONLY inside `app/providers/call_allocator.py` — because the pacing engine must never directly place calls; the Safety Controller is the architectural firewall between estimates and dialing — cost: an extra abstraction layer; enforced by import-linter test (M5).

D4: Safety Controller recomputes all counts (A, R, C) from the DB on every tick — because it cannot trust the pacing engine's numbers (the pacing engine is "estimating", the safety controller is "guaranteeing") — cost: a COUNT(*) query per tick; mitigated at scale by maintained counters (D11).

D5: Agent reservation is a single atomic SQL statement with `FOR UPDATE SKIP LOCKED LIMIT 1` — because two workers racing on the same agent must yield exactly one winner; SELECT-then-UPDATE would create a TOCTOU race — cost: requires Postgres (MySQL's SKIP LOCKED semantics differ slightly); limits DB portability.

D6: Every claim (agent reservation, dial task, event job) has a TTL lease with `reserved_until` / `expires_at` column — because worker crashes must not strand resources forever; the Reaper reclaims expired leases — cost: a Reaper process to run; clock skew between DB and app servers must be bounded.

D7: Event ingestion is one transaction (`INSERT ... ON CONFLICT DO NOTHING` + FSM apply) — because duplicate provider events must be idempotent and a crash mid-apply must roll back safely — cost: every event is a DB round-trip; at high throughput, batch commits (D12).

D8: State machines are table-driven dicts in pure Python (no DB imports) — because illegal/duplicate/late events must be log-and-ignored (never raise), and pure functions are trivially testable; `COMPLETED` accepted from any active state for convergence — cost: transitions are static (no per-event guards); if guards are needed later, refactor to functions.

D9: Each pacing tick runs inside `pg_advisory_xact_lock(hash(campaign_id))` — because two workers on the same campaign must not double-dial; transaction-scoped lock auto-releases on commit — cost: tick serialization per campaign (acceptable — ticks are cheap, 1s cadence).

D10: Every dial decision persisted in `dial_decisions` with all inputs + proposal + approval + clamp reasons — because the assignment asks "why 17 calls, not 10?" and the dashboard needs to show it — cost: write per tick; at scale, partition by day or roll up.

D11: Clock is injected (`Clock` interface, `SimClock` for tests, wall clock in production) — because the simulation must be deterministic (no `time.time()` in domain code) and providers must be injectable per campaign — cost: every domain function takes a `clock` param; minor verbosity.

D12: AIMD parameters: `alpha` in `[0.2, 1.0]`, halve on ABANDONED, +0.05 per clean interval — because fast back-off protects against answer-rate drops (the assignment's "70% → 10%" question), slow ramp recovers utilization — cost: alpha can oscillate near the boundary; mitigated by clean-interval definition (default 30s, no abandonment).

D13: Circuit breaker thresholds: failure EWMA > 0.3 OR latency p95 > 1000ms → OPEN, 30s cooldown — because provider outages must instantly halt new dials; the Safety Controller queries `breaker.state` to clamp to 0 — cost: threshold tuning is empirical; documented in ASSUMPTIONS.md.

D14: Predictive pacing math: EWMA(p_hat, d_hat, h_hat, sigma_hat) + binomial-safety inequality `u*(R+n) + z*sqrt((R+n)*u*(1-u)) <= A+F` with `z=2.33` (99th percentile) — because the assignment requires "why N calls?" to be answerable, and the inequality bounds over-answer probability — cost: EWMA lags regime shifts (the "least confident part" in ANSWERS.md §4); AIMD compensates.

D15: Atomic-attach-or-abandon for predictive ANSWERED events — because an unbound predictive call that answers must either bind an agent atomically (via `UPDATE agents SET status='CONNECTED' WHERE id=(... SKIP LOCKED ...) AND status='AVAILABLE'`) or be ABANDONED after a 3s grace period — because an abandoned connected call is a compliance event under RBI fair-practices code — cost: ABANDONED feeds AIMD (halve alpha), creating a self-correcting feedback loop.

D16: Silent degradation floor to exact progressive — because when metrics are stale / abandonment > 3% / circuit OPEN, the Safety Controller forces `mode_used='PROGRESSIVE'` with `n_approved <= A` — because the worst-case behavior must be "exactly like progressive dialing", never worse — cost: utilization drops during degradation (acceptable — safety > utilization).

D17: Structured JSON logs + OpenTelemetry spans + Prometheus-style `/metrics` endpoint — because the live discussion will ask "why 17 calls?" and you need traceable evidence; also demonstrates observability-as-design (your AI-engineering strength) — cost: extra instrumentation code; spans are no-ops if OTLP not configured.

D18: React dashboard uses Postgres LISTEN/NOTIFY over WebSocket (no extra pub/sub) — because the assignment explicitly discourages adding tech; LISTEN/NOTIFY is sufficient for a single-node dashboard — cost: doesn't scale to multi-node dashboard deployments (would need Redis pub/sub at scale — note in ANSWERS.md).

D19: Bearer token auth on dashboard WebSocket (env `DASHBOARD_TOKEN`) — because demonstrating authn/authz awareness is part of the AI-engineering breadth; production would use short-lived JWTs — cost: token rotation is manual in the prototype.

D20: Plain SQL migrations (no Alembic) — because for a prototype with one migration, raw SQL is simpler to review and avoids an extra dependency; the assignment values simplicity — cost: schema evolution requires manual migration files; fine for prototype, switch to Alembic if migrations > 5.

---

## Decisions appended during build

_(Antigravity will append new decisions here as it makes non-obvious choices during M0–M8. Format: `D<seq>: <decision> — because <reason> — cost: <what it makes harder>`)_

D21: _(to be added during build)_
D22: _(to be added during build)_
