# ANSWERS.md — CredResolve Technical Assignment Responses

This document contains detailed engineering responses to the core technical assignment questions, scalability bottlenecks, failure drills, and architectural reflections.

---

## Answer 1: Predictive Utilization With Deterministic Progressive Safety

> **Question:** How would you build a SmartDialer that gets as much of the utilization benefit of predictive dialing as possible, while retaining the deterministic safety characteristics of progressive dialing?

To achieve maximum predictive agent utilization without ever taking shortcuts on regulatory call safety, deterministic safety must be treated as an **architectural invariant**, not merely an algorithmic heuristic. In our system, this is achieved through a three-tier design:

1. **Mathematically Risk-Bounded Dialing via the Safety Controller Firewall:**
   The predictive pacing engine only generates speculative proposals. It is structurally prohibited from contacting telecom providers. All dial proposals must pass through a non-bypassable Safety Controller that recomputes active available agents ($A$), in-flight ringing calls ($R$), and connected calls ($C$) directly from the database. It clamps approved dials using a 99th-percentile upper confidence bound on the borrower answer rate ($u = \text{clamp}(\hat{p} + 2\hat{\sigma}, 0.05, 0.98)$) by solving the quadratic inequality:
   $$u(R + n) + z\sqrt{(R + n)u(1 - u)} \le A + F$$
   where $z = 2.33$ (standard normal 99th percentile) and $F = C \times \min(1, \hat{d}/\hat{h})$ accounts for agents who will complete existing calls during call setup time $\hat{d}$. This guarantees that the probability of more borrowers answering than agents available is strictly bounded below 1%, even under pessimistic variance.

2. **Atomic-Attach-or-Abandon with Fast AIMD Feedback:**
   Predictive calls are placed unbound (without pre-reserving an agent). When a borrower answers, the system executes an atomic reservation query (`UPDATE agents SET status='CONNECTED' WHERE id = (SELECT id FROM agents WHERE status='AVAILABLE' ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`). If an agent is free, the connection occurs in under 50ms. If no agent is free, a 3-second grace period allows wrapping agents to clear. If an agent is still unavailable, the call is immediately transitioned to `ABANDONED`. Under our AIMD (Additive Increase, Multiplicative Decrease) controller, a single abandonment event instantly halves aggressiveness ($\alpha = \max(0.2, \alpha / 2)$), while clean intervals slowly ramp $\alpha$ by $+0.05$. The system automatically throttles down the moment conditions tighten.

3. **Deterministic Progressive Floor:**
   Whenever statistical confidence drops—whether due to circuit breaker trips, stale metrics, or rolling abandonment exceeding 3%—the Safety Controller forces an unconditional progressive fallback ($n_{\text{approved}} \le A$, agent pre-reserved prior to origination). Even if all statistical models fail, the architectural floor guarantees that the dialer behaves exactly like a deterministic progressive dialer.

---

## Answer 2: Scalability Bottlenecks (100 → 1,000 → 10,000 Agents)

> **Question:** What breaks first at 100 → 1,000 → 10,000 agents? How would you fix it?

Scaling a dialer is fundamentally a **database write and lock contention challenge**, not an application CPU problem. Pacing calculations are trivial floating-point operations taking microseconds; the database transaction boundaries determine scalability limits.

### 100 Agents: Trivial Execution
At 100 agents (~30–50 calls/second), a single PostgreSQL instance on modest cloud hardware (2 vCPU, 4GB RAM) operates comfortably under 15% utilization. `COUNT(*)` queries across `agents` and `calls` execute in under 1ms because table cardinality is small. Partial indexes (`WHERE status='AVAILABLE'`) keep index scans minimal, and `pg_advisory_xact_lock` serializes ticks with zero contention.

### 1,000 Agents: Aggregation and Row-Lock Contention
At 1,000 agents (~300–500 calls/second), two specific bottlenecks emerge:
1. **`COUNT(*)` Overhead on Active Calls:** As the calls table accumulates tens of thousands of attempts throughout the day, aggregate queries for $R$ and $C$ on each 1-second tick begin showing elevated P95 latency (~40–80ms).
   - *Fix:* Introduce maintained atomic counters on the `campaigns` table (e.g., `agents_available_count`, `calls_in_flight_count`), incremented/decremented in the same transaction that applies state transitions. A nightly reconciliation job re-synchronizes counters to prevent drift.
2. **Index Contention on `idx_agents_available`:** When multiple worker processes race the `SKIP LOCKED` query simultaneously, index lock latch contention occurs at the top of the index tree.
   - *Fix:* Transition from single-agent reservations to **batched reservations**. A worker claims a batch of $K=5$ or $K=10$ agents in a single `UPDATE ... LIMIT K` statement, reducing transaction commit overhead by an order of magnitude.

### 10,000 Agents: Write Throughput Limiter
At 10,000 agents (~3,000–5,000 calls/second), PostgreSQL transaction commit frequency and write-ahead log (WAL) IOPS become the hard architectural bottleneck. Inserting individual rows for every telecom event and dial decision generates 15,000+ IOPS, saturating disk write pipelines.
- *Fixes in Order:*
  1. **Batched Event Ingestion:** Rather than committing each provider webhook in an isolated transaction, the event ingest worker consumes events from an in-memory ring buffer and executes bulk inserts (`INSERT ... ON CONFLICT DO NOTHING`) in micro-batches of 50–100 events per transaction.
  2. **Table Partitioning:** Partition `provider_events`, `calls`, and `dial_decisions` by day (`received_at` / `decided_at`). Active partitions fit completely in memory, and historic partitions are detached and archived to object storage without table bloat.
  3. **Dashboard Rollups:** Replace per-row `LISTEN/NOTIFY` triggers with a 1-second background aggregator that computes aggregate gauges and broadcasts aggregated JSON frames to connected WebSocket clients.
  4. **Outbox Pattern (Last Resort):** Only if write throughput exceeds 20,000 writes/sec would we introduce an outbox buffer or Kafka stream. In accordance with CredResolve's design principles, we do not prematurely add message brokers when PostgreSQL with batching comfortably supports 10,000 agents.

---

## Answer 3: The 5 Failure Drills

### Drill 1: Worker Crash Mid-Flow
- **Scenario:** An agent is reserved, borrower selected, and call initiated, but the worker process is killed (`kill -9`) before completing the cycle.
- **Observed Behavior:** The agent reservation and the dial task hold explicit TTL leases (`reserved_until = now() + 30s`). While the worker is dead, no other process can overwrite the reservation. Once the TTL expires, the background `Reaper` job scans for expired leases, sets `agents.status = 'AVAILABLE'`, clears `reserved_by`, and calls `provider.get_status()` to reconcile the stranded call. If the call was answered during the crash, it transitions to `ABANDONED` and triggers AIMD back-off.
- **Code Locations:** `app/worker/reaper.py` (lines 35–85), `tests/test_crash_drill.py`.

### Drill 2: Provider Outage
- **Scenario:** The telecom carrier begins timing out or returning 500 errors on `originate` calls.
- **Observed Behavior:** The `CircuitBreaker` wrapping the provider tracks failure EWMA and consecutive errors. Upon encountering 5 consecutive origination failures or failure EWMA exceeding 0.3, the breaker state trips to `OPEN`. The Safety Controller detects `breaker.state == 'OPEN'` and clamps approved dials to zero (`n_approved = 0, clamp_reasons = ['circuit_open']`). Existing in-flight calls continue through event ingestion. After a 30-second cooldown, the breaker permits 1 probe call in `HALF_OPEN`; once successful, normal dialing resumes.
- **Code Locations:** `app/providers/circuit_breaker.py` (lines 55–90), `tests/test_circuit_breaker.py`.

### Drill 3: Sudden Agent Availability Drop
- **Scenario:** 100 agents are available, and 40 agents abruptly disconnect or log off within seconds.
- **Observed Behavior:** Disappearing agents stop emitting heartbeats. Within 60 seconds, the Reaper marks them `OFFLINE`. However, even before the Reaper runs, any agent that clicks logoff or pause immediately updates their status in PostgreSQL. On the very next 1-second pacing tick, the Safety Controller re-queries `COUNT(*) FROM agents WHERE status='AVAILABLE'` directly from the DB. $A$ drops from 100 to 60, and the closed-form binomial clamp re-evaluates within 1 tick, preventing over-dialing.
- **Code Locations:** `app/safety/controller.py` (lines 115–140), `app/worker/reaper.py`, `tests/test_progressive.py`.

### Drill 4: Duplicate Provider Events
- **Scenario:** The telecom provider sends duplicate webhooks (e.g., `ANSWERED` delivered 3 times for the same call leg).
- **Observed Behavior:** The `provider_events` table enforces a unique constraint on `event_id`. The ingest worker executes `INSERT INTO provider_events ... ON CONFLICT (event_id) DO NOTHING`. If no row is returned, the event is identified as a duplicate and immediately discarded without invoking any state machine transitions.
- **Code Locations:** `app/worker/event_ingest_worker.py` (lines 65–85), `tests/test_event_chaos.py`.

### Drill 5: Out-of-Order Provider Events
- **Scenario:** Telephony network delays cause events to arrive out of order (e.g., `COMPLETED` arrives before `ANSWERED` and `RINGING`).
- **Observed Behavior:** The domain state machine is a pure-Python table-driven function. When `COMPLETED` arrives first, it is accepted from any active state under the convergence rule, transitioning the call to terminal `COMPLETED`. When the delayed `ANSWERED` or `RINGING` subsequently arrives, the state machine recognizes that the current state is in `TERMINAL_CALL_STATES` and returns `(current, False)` as an idempotent no-op. The call converges cleanly.
- **Code Locations:** `app/domain/fsm.py` (lines 35–65), `tests/test_event_chaos.py`, `tests/test_fsm.py`.

---

## Answer 4: Least Confident Component (Engineering Reflection)

The component I am least confident about in production is the **EWMA estimator for $\hat{\sigma}$ (answer-rate variance)** during sharp regime shifts. 

While an Exponentially Weighted Moving Average is computationally elegant, stateless, and trivial to persist in a single database column, it is fundamentally a low-pass filter with an inherent time lag. In Scenario D, when the answer rate abruptly drops from 70% to 10%, the EWMA variance estimate remains artificially inflated by the previous regime's volatility for several intervals. Consequently, the pessimistic safety bound ($u = \hat{p} + 2\hat{\sigma}$) remains excessively loose and conservative for 30–45 seconds after the shift, causing the Safety Controller to unnecessarily throttle dials and temporarily degrade agent utilization.

A production-grade improvement would be replacing the single EWMA estimator with a **Bayesian Beta-Binomial conjugate model** equipped with change-point detection (such as the Page-Hinkley test or CUSUM). When a statistically significant divergence in answer rate occurs, the prior confidence would instantly reset, allowing the dialer to adapt to the new regime in 2–3 ticks rather than lagging. I selected EWMA for this prototype because it requires zero external dependencies, introduces zero runtime latency, and is easily auditable by another engineer during technical review.
