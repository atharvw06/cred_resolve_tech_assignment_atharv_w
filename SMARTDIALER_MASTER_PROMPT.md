# SMARTDIALER — MASTER BUILD PROMPT FOR ANTIGRAVITY

> **Single source of truth for building CredResolve's collections SmartDialer prototype.**
> Build all of M0–M8 in ONE agentic session. No STOPs between phases. Commit per milestone.
> Paste this entire file into Antigravity. Do not summarize or truncate it.

---

## 0. PREAMBLE — How to use this prompt

You are Antigravity, an agentic coding IDE. The user has pasted this entire prompt to drive a single end-to-end build of a SmartDialer prototype for CredResolve (an AI debt-recovery startup; see §1).

**Execution contract:**
1. Read this prompt fully before writing any code.
2. Create the project at `/home/z/my-project/smartdialer/`.
3. Use a TODO list to track M0–M8 milestones. Tick each box as its DONE criteria pass.
4. Build sequentially M0 → M8. Run narrow tests during dev (`pytest -k <module>`); full suite at each milestone boundary.
5. Commit after each milestone with conventional commit messages (`feat(M2): reservation service with SKIP LOCKED`).
6. Targeted diffs only. NEVER regenerate an entire file to change a few lines — use Edit.
7. Zero speculative code. Zero "future-proof" abstractions beyond the provider interface.
8. When choosing between options: pick the simpler one, log it in `DECISIONS.md`, move on. Do NOT ask open-ended questions; record assumptions in `ASSUMPTIONS.md` instead.
9. **Allowed dependencies**: `fastapi`, `uvicorn`, `sqlalchemy`, `asyncpg` (optional), `psycopg2` or `psycopg`, `pydantic`, `pytest`, `httpx`, `hypothesis` (for property tests), `import-linter` (for the firewall test). Frontend: Vite React-TS template + `recharts`. **NOTHING else.** No Redis, no Kafka, no Celery, no LangChain, no extra UI libs. If you're tempted to add a dep, don't — log it in `ASSUMPTIONS.md` and pick a simpler path.
10. Final step: print a ≤15-line status summary listing what's done, what's tested, what's left (should be nothing), and the path to run the demo.

**Files you must create at the very start (Step 0, before any code):**
- `ROADMAP.md` — milestone checklist with DONE criteria as checkboxes. (A starter version is provided alongside this prompt; use it.)
- `DECISIONS.md` — ADR log. Every non-obvious choice gets one line: `D<seq>: <decision> — because <reason> — cost: <what it makes harder>`. Pre-seed it with the key decisions (a starter version is provided).
- `ASSUMPTIONS.md` — anything you had to guess; never block on questions.

**Source of truth hierarchy:** BRIEF.md (the assignment PDF text) wins for *requirements*; this prompt wins for *implementation specifics*. If they appear to disagree, BRIEF.md wins — re-read it.

---

## 1. MISSION & BUSINESS CONTEXT

**CredResolve** is an India-based AI debt-recovery startup (raised $1.1M seed, March 2025). Their product helps banks and NBFCs recover non-performing loans (NPLs) using AI-driven borrower engagement, regulatory-compliant automation, and connectivity scoring.

**The problem you're solving:** Collections agents spend most of their day waiting — dialing numbers that don't connect, doing manual work a system should handle. CredResolve needs a SmartDialer that:
- Improves agent utilization (more connected borrower conversations per agent-hour).
- Never abandons a connected borrower call. In India, an abandoned connected call to a borrower is not just bad UX — under RBI fair-practices code on debt collection and TRAI DNC/telemarketing rules, repeated abandoned calls can trigger regulatory action against the lender and damage the recovery relationship.

**Two dialing modes:**
1. **Progressive** — one available agent → one outbound call. Predictable, safe, but agents idle while borrowers don't answer.
2. **Predictive** — start calls *before* an agent is free, based on estimated answer rate. Higher utilization, but risks "more borrowers answer than agents available" → abandonment → compliance violation.

**The hard problem (the actual assignment):** Build a SmartDialer that gets as much predictive-utilization benefit as possible while retaining the deterministic safety of progressive dialing. The predictive engine must NEVER directly place a call — a separate **Safety Controller** sits between pacing and the telecom provider, recomputes all counts from the DB, and can approve / reduce / reject / force progressive fallback. The pacing engine cannot disable it.

**Why this matters for the interview:** CredResolve will spend the technical discussion trying to break your system — racing workers on the same agent, provider chaos, sudden agent drop, duplicate/out-of-order events, scale to 10k agents. This prompt encodes the answers. Implement it faithfully and you'll be able to defend every decision.

**Tone of the codebase:** Production-grade but minimal. Every file should read like it was written by an engineer who has shipped a dialer before — no toy examples, no commented-out code, no `TODO: implement later`.

---

## 2. INVARIANTS — Non-negotiable architecture rules

These are immutable. Violating any of them is a build failure. Each rule exists because the assignment explicitly tests for it.

1. **Postgres is the single source of truth.** No Redis, no Kafka, no message broker, no in-memory caches for state that must survive a crash. Justify in `DECISIONS.md`: `SKIP LOCKED` queues, advisory locks, transactions = exactly-once state transitions, `LISTEN/NOTIFY` for the dashboard. One DB, one truth. The DB wins every tie (see interview question "DB says AVAILABLE, cache says RESERVED — which wins?" → DB).

2. **Provider clients are importable ONLY inside `app/providers/call_allocator.py`.** The Safety Controller is the only caller of the allocator. The pacing engine may only call `safety_controller.request_calls(n) -> approved`. Add an **import-linter test** in CI that FAILS if pacing imports anything from providers. This is the architectural firewall between "estimates" and "actual dialing."

3. **Safety Controller recomputes all counts (agents, in-flight calls) from the DB.** It never trusts the pacing engine's numbers. It can approve, reduce, reject, or force progressive fallback. The pacing engine cannot disable it.

4. **Agent reservation is a single atomic SQL statement** (no SELECT-then-UPDATE race):
   ```sql
   UPDATE agents
   SET status='RESERVED', reserved_by=:w, reserved_until=now()+interval '30 seconds'
   WHERE id = (
     SELECT id FROM agents
     WHERE status='AVAILABLE'
     ORDER BY last_call_ended_at NULLS FIRST
     FOR UPDATE SKIP LOCKED LIMIT 1
   ) RETURNING *;
   ```
   This is the answer to "two workers race on one agent" — `SKIP LOCKED` guarantees exactly one wins. `last_call_ended_at NULLS FIRST` is the round-robin fairness knob.

5. **Every claim has a TTL lease.** Reservation, dial task, event job — each gets a `reserved_until` / `expires_at` column. A **Reaper job** runs every few seconds: reclaims expired leases, releases agents back to AVAILABLE, reconciles stuck calls via `provider.get_status()`, flips heartbeat-stale agents to OFFLINE. This is the TTL mechanism the assignment is silently testing.

6. **Event ingestion is one transaction.** `INSERT INTO provider_events ... ON CONFLICT (event_id) DO NOTHING` + apply FSM transition in the same transaction. Crash ⇒ rollback ⇒ safe retry. Duplicate events are no-ops (idempotent). Late events converge (see §5).

7. **State machines are table-driven (dict of allowed transitions) and pure Python (no DB imports).** All illegal/duplicate/late events are logged-and-ignored, NEVER raise. `COMPLETED` is accepted from any active state (converges). This is how you survive `COMPLETED, ANSWERED, RINGING` — the late events are dropped silently.

8. **Each pacing tick runs inside `pg_advisory_xact_lock(hash(campaign_id))`.** Two workers on the same campaign can't double-dial. Lock is transaction-scoped — auto-released on commit/rollback.

9. **Every dial decision is persisted in `dial_decisions`** with: all inputs (A, R, C, p_hat, d_hat, h_hat, F, alpha, provider circuit state), the proposal `n_proposed`, the final `n_approved`, and the clamp reasons (e.g., `["binomial_safety_bound", "circuit_open"]`). This answers "why 17 calls, not 10?" — query the table by `tick_id`. The dashboard reads this table.

10. **Clock is injected** (`Clock` interface): `SimClock` for simulation/tests, wall clock in production. Providers are injected per campaign. No `time.time()` in domain code — only `clock.now()`. This is what makes the simulation deterministic.

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Pipeline (literal in code)

```
Campaign ─▶ Pacing Engine (Progressive | Predictive)
                │
                │  request_calls(n)  ← pacing engine may ONLY call this
                ▼
         Safety Controller  ← recomputes A, R, C from DB; can reduce/reject/force progressive
                │
                │  approved_n
                ▼
         Call Allocator  ← ONLY place that imports provider clients
                │
                ▼
         Telecom Provider (A | B)  ← circuit breaker wraps each
```

### 3.2 Component responsibilities

| Component | Responsibility | Cannot do |
|---|---|---|
| Campaign | Owns pacing config (mode, alpha, scenario) | Place calls |
| Pacing Engine | Compute `n_proposed` from DB counts + EWMA stats | Import providers; bypass safety |
| Safety Controller | Recompute counts; clamp `n_proposed` to safe bound | Be disabled by pacing |
| Call Allocator | Reserve agent (atomic SQL); call provider.originate; persist call row | Compute pacing |
| Telecom Provider | originate / get_status / event stream | Know about agents or pacing |
| Reaper | Reclaim expired leases; reconcile stuck calls; offline stale agents | Mutate pacing decisions |
| Worker | Loop: tick pacing → safety → allocator → ingest events | Hold state in memory |
| API | REST: campaign CRUD, agent login/heartbeat, event webhook, dashboard polling | Bypass worker |
| Dashboard | React-TS, WebSocket via LISTEN/NOTIFY | Mutate state directly |

### 3.3 Observability hooks (AI-engineering strength: tracing + structured logs + metrics)

These are not optional decoration — they're how you defend "why 17 calls" in the live discussion, and they demonstrate production-readiness.

- **Structured JSON logs** everywhere (no `print()`, no f-string logs). Each log line: `{"ts": "...", "level": "INFO", "trace_id": "...", "span_id": "...", "component": "safety_controller", "event": "clamp", "payload": {...}}`. Use `structlog` if you must, or hand-roll a 30-line JSON formatter.
- **OpenTelemetry spans** on: every pacing tick (attributes: `campaign_id`, `A`, `R`, `C`, `n_proposed`, `n_approved`), every `provider.originate` call (attributes: `provider`, `provider_call_id`, `latency_ms`, `outcome`), every reservation (attributes: `agent_id`, `worker_id`). If no OTLP collector is configured, spans are no-ops — but the instrumentation is in place.
- **Metrics endpoint** `GET /metrics` exposing Prometheus-style text: `dial_decisions_total{campaign,mode}`, `agent_state{status}` (gauge per state), `calls{state}` (gauge), `provider_failures_total{provider}`, `safety_clamps_total{reason}`, `reaper_reclaims_total`. This is how the dashboard's pacing panel gets its data cheaply.

### 3.4 Sequence — a single predictive dial decision

```
Worker tick (every 1s, locked by pg_advisory_xact_lock(campaign_id)):
  1. PacingEngine.propose(campaign_id, db, clock) → n_proposed, inputs
  2. SafetyController.approve(campaign_id, n_proposed, db, clock) → n_approved, clamp_reasons
  3. INSERT INTO dial_decisions (...)
  4. pg NOTIFY 'dial_decision', payload  ← dashboard picks this up via LISTEN
  5. If n_approved > 0:
       For i in range(n_approved):
         - CallAllocator.dial(campaign_id, db, provider, clock)
           (reserve agent OR originate unbound, depending on mode)
  6. Commit transaction (releases advisory lock)
```

---

## 4. DATA MODEL — PostgreSQL schema

Create under `migrations/001_init.sql` (plain SQL, no Alembic — simpler, faster to review). Use `UUID` PKs. All timestamps `TIMESTAMPTZ`, default `now()`.

```sql
-- Campaigns: a dialing campaign for a portfolio of borrowers
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PROGRESSIVE','PREDICTIVE')),
  provider TEXT NOT NULL CHECK (provider IN ('A','B')),
  alpha REAL NOT NULL DEFAULT 0.5 CHECK (alpha >= 0.2 AND alpha <= 1.0),
  -- EWMA estimators (persisted; updated on every event)
  p_hat REAL NOT NULL DEFAULT 0.3,
  d_hat REAL NOT NULL DEFAULT 8.0,      -- seconds: originate→answer
  h_hat REAL NOT NULL DEFAULT 120.0,   -- seconds: handle+wrap
  sigma_hat REAL NOT NULL DEFAULT 0.1,
  -- AIMD state
  last_abandoned_at TIMESTAMPTZ,
  clean_intervals_since_abandon INT NOT NULL DEFAULT 0,
  -- Compliance cooldown
  progressive_cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true
);

-- Agents: collection agents (human)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN
    ('OFFLINE','AVAILABLE','RESERVED','DIALING','CONNECTED','WRAP_UP','PAUSED')),
  reserved_by TEXT,                    -- worker_id holding the lease
  reserved_until TIMESTAMPTZ,           -- TTL lease expiry
  last_call_ended_at TIMESTAMPTZ,       -- round-robin fairness key (NULLS FIRST)
  last_heartbeat_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial index: only AVAILABLE agents are scanned for reservation
CREATE INDEX idx_agents_available ON agents (last_call_ended_at NULLS FIRST)
  WHERE status = 'AVAILABLE';

-- Borrowers: debtors to call
CREATE TABLE borrowers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  phone TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,      -- higher = call first
  call_count INT NOT NULL DEFAULT 0,
  last_called_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_borrowers_campaign_priority
  ON borrowers (campaign_id, priority DESC, last_called_at NULLS FIRST);

-- Calls: a single outbound call attempt
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  borrower_id UUID REFERENCES borrowers(id),
  agent_id UUID REFERENCES agents(id),         -- nullable for predictive (unbound until ANSWERED)
  provider TEXT NOT NULL,
  provider_call_id TEXT,                       -- returned by provider.originate
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN
    ('QUEUED','RESERVED','INITIATED','RINGING','ANSWERED','CONNECTED',
     'COMPLETED','FAILED','CANCELLED','ABANDONED')),
  reserved_by TEXT,                              -- worker_id holding this dial task
  reserved_until TIMESTAMPTZ,                    -- TTL lease on the dial task
  initiated_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calls_state ON calls (state);
CREATE INDEX idx_calls_provider_call_id ON calls (provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE INDEX idx_calls_campaign_state ON calls (campaign_id, state);

-- Provider events: idempotent ingest. event_id from provider = natural key.
CREATE TABLE provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,                 -- idempotency: ON CONFLICT DO NOTHING
  provider_call_id TEXT,
  event_type TEXT NOT NULL,                      -- INITIATED,RINGING,ANSWERED,COMPLETED,FAILED
  payload JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_provider_events_call ON provider_events (provider_call_id);
CREATE INDEX idx_provider_events_unprocessed ON provider_events (received_at)
  WHERE applied_at IS NULL;  -- if you add applied_at column; optional

-- Dial decisions: the audit trail. Answers "why 17 calls?"
CREATE TABLE dial_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  tick_id BIGINT NOT NULL,                       -- monotonic per-campaign tick counter
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Inputs (snapshot at decision time)
  agents_available INT NOT NULL,                  -- A
  calls_initiated_or_ringing INT NOT NULL,        -- R
  calls_answered_or_connected INT NOT NULL,       -- C
  p_hat REAL NOT NULL,
  d_hat REAL NOT NULL,
  h_hat REAL NOT NULL,
  f_available REAL NOT NULL,                      -- C * min(1, d_hat/h_hat)
  alpha REAL NOT NULL,
  provider_circuit TEXT NOT NULL,                -- CLOSED|OPEN|HALF_OPEN
  -- Proposal & decision
  n_proposed INT NOT NULL,
  n_approved INT NOT NULL,
  clamp_reasons TEXT[] NOT NULL DEFAULT '{}',     -- e.g., ['binomial_safety','circuit_open']
  mode_used TEXT NOT NULL                         -- PROGRESSIVE|PREDICTIVE (post-safety)
);
CREATE INDEX idx_dial_decisions_campaign_tick ON dial_decisions (campaign_id, tick_id);

-- Generic lease registry (optional cross-cutting audit; per-row reserved_until columns are primary)
CREATE TABLE leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,                   -- agent|call|event_job
  resource_id UUID NOT NULL,
  holder TEXT NOT NULL,                           -- worker_id
  expires_at TIMESTAMPTZ NOT NULL,
  released BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leases_expires ON leases (expires_at) WHERE NOT released;

-- Heartbeat table (alternative: use agents.last_heartbeat_at directly — simpler)
-- Decision: use the column on agents. Logged in DECISIONS.md.
```

---

## 5. STATE MACHINES — Agent + Call

Both live in `app/domain/fsm.py`. Pure Python, table-driven, no DB imports.

```python
# app/domain/fsm.py
"""Pure-Python table-driven state machines. No DB imports."""

AGENT_TRANSITIONS = {
    ('OFFLINE',    'login'):           'AVAILABLE',
    ('AVAILABLE',  'reserve'):         'RESERVED',     # via SKIP LOCKED SQL
    ('RESERVED',   'dial'):            'DIALING',
    ('DIALING',    'connect'):         'CONNECTED',
    ('CONNECTED',  'wrap_up'):         'WRAP_UP',
    ('WRAP_UP',    'ready'):           'AVAILABLE',
    ('AVAILABLE',  'pause'):           'PAUSED',
    ('PAUSED',     'resume'):          'AVAILABLE',
    ('RESERVED',   'release'):         'AVAILABLE',    # explicit release / cancel
    ('RESERVED',   'expire'):          'AVAILABLE',    # TTL expiry (reaper)
    ('DIALING',    'call_failed'):     'AVAILABLE',    # provider returned FAILED
    # Predictive atomic attach: AVAILABLE -> CONNECTED in one UPDATE
    # (used when a predictive ANSWERED arrives and an agent is free)
    ('AVAILABLE',  'atomic_attach'):   'CONNECTED',
    # Heartbeat lost → OFFLINE from any state (handled by reaper, not this dict)
}

CALL_TRANSITIONS = {
    # Progressive: bind agent first
    ('QUEUED',     'reserve'):         'RESERVED',
    ('RESERVED',   'initiate'):        'INITIATED',
    # Predictive: initiate unbound (no agent yet)
    ('QUEUED',     'initiate'):        'INITIATED',
    ('INITIATED',  'ringing'):         'RINGING',
    ('INITIATED',  'fail'):            'FAILED',
    ('RINGING',    'answer'):          'ANSWERED',
    ('RINGING',    'fail'):            'FAILED',
    ('INITIATED',  'cancel'):          'CANCELLED',
    ('RINGING',    'cancel'):          'CANCELLED',
    ('ANSWERED',   'connect'):         'CONNECTED',    # agent bound (predictive path)
    ('ANSWERED',   'abandon'):         'ABANDONED',    # no agent — COMPLIANCE EVENT, feeds AIMD
    ('CONNECTED',  'complete'):        'COMPLETED',
    # CONVERGENCE: COMPLETED is accepted from any active state (crash recovery)
    # Implemented in apply_call_event() — see below.
}

TERMINAL_CALL_STATES = frozenset({'COMPLETED', 'FAILED', 'CANCELLED', 'ABANDONED'})


def transition(transitions: dict, current: str, event: str) -> tuple[str, bool]:
    """
    Pure function. Returns (new_state, applied).
    Never raises. All illegal/duplicate/late events are log-and-ignored.
    """
    # Already terminal: idempotent no-op (duplicate COMPLETED, late ANSWERED, etc.)
    if current in TERMINAL_CALL_STATES:
        return current, False
    # Convergence rule: COMPLETED is accepted from any active state.
    if event == 'complete':
        return 'COMPLETED', True
    key = (current, event)
    if key in transitions:
        return transitions[key], True
    # Illegal transition — log-and-ignore (the caller logs).
    return current, False


def agent_transition(current: str, event: str) -> tuple[str, bool]:
    return transition(AGENT_TRANSITIONS, current, event)


def call_transition(current: str, event: str) -> tuple[str, bool]:
    return transition(CALL_TRANSITIONS, current, event)
```

### 5.1 Convergence rules (critical for chaos tests)

- Duplicate `ANSWERED, ANSWERED, ANSWERED, COMPLETED` → final state `COMPLETED`. Each duplicate is a no-op (returns `(current, False)`).
- Out-of-order `COMPLETED, ANSWERED, RINGING` → final state `COMPLETED`. The late `ANSWERED` and `RINGING` see `current='COMPLETED'` (terminal) and return `(current, False)`.
- Worker crashes after `ANSWERED` → call row persists in `ANSWERED`. Reaper reconciles via `provider.get_status()`:
  - If status is `CONNECTED`-equivalent and an agent is AVAILABLE → atomic-attach agent (`UPDATE agents SET status='CONNECTED' WHERE id=:id AND status='AVAILABLE'`), transition call to `CONNECTED`.
  - If no agent available within TTL → transition call to `ABANDONED` (compliance event), feed AIMD (halve alpha).

### 5.2 Atomic attach (predictive safety net)

When a predictive (unbound) call's `ANSWERED` event arrives, the worker tries to bind an agent atomically:
```sql
UPDATE agents SET status='CONNECTED', reserved_until=NULL
WHERE id = (
  SELECT id FROM agents WHERE status='AVAILABLE'
  ORDER BY last_call_ended_at NULLS FIRST
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING *;
```
If the query returns a row → bind it to the call, transition call `ANSWERED → CONNECTED`.
If empty → no agent available. The call transitions to `ABANDONED` after a short grace period (e.g., 3s). This is the silent-degradation floor — see ANSWERS.md §1.

---

## 6. PREDICTIVE PACING — Full math

All in `app/pacing/predictive.py` and `app/safety/controller.py`. Implement exactly.

### 6.1 EWMA estimators (per campaign, persisted in `campaigns` table)

```
# alpha_ewma is the EWMA smoothing factor (NOT the same as the AIMD alpha)
# Updates happen on each event apply:
p_hat    = EWMA(answer_rate,    alpha_ewma=0.3)   # P(borrower answers a dial)
d_hat    = EWMA(originate_to_answer_secs, alpha_ewma=0.3)
h_hat    = EWMA(handle_plus_wrap_secs,    alpha_ewma=0.1)   # smoother, longer-lived
sigma_hat = EWMA(answer_rate_variance,    alpha_ewma=0.3)   # for safety upper bound

# Update rules:
#   On ANSWERED:    p_hat numerator+1, denom+1; d_hat updated with originate→answer secs
#   On FAILED/CANCELLED: denom+1 only (no answer)
#   On COMPLETED:   h_hat updated with handle+wrap secs
#   On ABANDONED:   h_hat updated (partial), triggers AIMD halve
```

### 6.2 Available-equivalent agents F

```
A = count(agents WHERE status='AVAILABLE')
R = count(calls WHERE state IN ('INITIATED','RINGING'))
C = count(calls WHERE state IN ('ANSWERED','CONNECTED'))
F = C * min(1, d_hat / h_hat)        # agents who will become free soon
```

`F` is the "soon-to-be-free" estimate. If calls average 8s to answer and 120s to handle, then ~7% of connected agents free up per second. `F` is that pipeline.

### 6.3 Proposal (pacing engine)

```python
n_proposed = floor(alpha * (A + F) / max(p_hat, 0.05))
```

`alpha` is the AIMD-tuned aggressiveness in `[0.2, 1.0]` (see §6.5). The `max(p_hat, 0.05)` floor prevents divide-by-zero on cold-start and caps the proposal when answer rate is unknown.

### 6.4 Safety Controller (the hard part — implement in `app/safety/controller.py`)

Recompute A, R, C **from the DB** (do not trust pacing's numbers). Then:

```python
def approve(self, campaign_id, n_proposed, db, clock) -> Approval:
    # Recompute from DB
    A = await count(db, "SELECT count(*) FROM agents WHERE status='AVAILABLE' AND campaign_id=:c", c=campaign_id)
    R = await count(db, "SELECT count(*) FROM calls WHERE state IN ('INITIATED','RINGING') AND campaign_id=:c", c=campaign_id)
    C = await count(db, "SELECT count(*) FROM calls WHERE state IN ('ANSWERED','CONNECTED') AND campaign_id=:c", c=campaign_id)
    # ... read p_hat, d_hat, h_hat, sigma_hat, alpha from campaigns row ...
    F = C * min(1.0, d_hat / max(h_hat, 1.0))

    # Pessimistic answer rate (upper confidence bound)
    u = clamp(p_hat + 2 * sigma_hat, 0.05, 0.98)
    z = 2.33  # 99th percentile standard normal

    # Find largest n >= 0 such that:
    #   u * (R + n) + z * sqrt((R + n) * u * (1 - u))  <=  A + F
    #
    # Closed-form (quadratic in x = sqrt(R + n)):
    #   u * x^2 + z * sqrt(u*(1-u)) * x - (A + F) <= 0
    #   x_max = (-z*sqrt(u*(1-u)) + sqrt(z^2*u*(1-u) + 4*u*(A+F))) / (2*u)
    #   n_max = max(0, floor(x_max^2 - R))
    inner = z * math.sqrt(u * (1 - u))
    x_max = (-inner + math.sqrt(inner * inner + 4 * u * (A + F))) / (2 * u)
    n_max = max(0, int(math.floor(x_max * x_max - R)))

    n_approved = min(n_proposed, n_max)
    clamp_reasons = []
    if n_approved < n_proposed:
        clamp_reasons.append('binomial_safety_bound')

    # Hard caps
    circuit_state = self.breakers[campaign.provider].state
    if circuit_state == 'OPEN':
        n_approved = 0
        clamp_reasons.append('circuit_open')
    if self._metrics_stale(campaign, clock):
        # Force progressive fallback: cap to A
        n_approved = min(n_approved, A)
        clamp_reasons.append('metrics_stale_progressive_fallback')
    if self._window_abandonment_rate(campaign) > 0.03:
        # Progressive cooldown 60s
        n_approved = min(n_approved, A)
        clamp_reasons.append('abandonment_cooldown_3pct')

    mode_used = 'PROGRESSIVE' if 'progressive' in ' '.join(clamp_reasons).lower() else campaign.mode
    return Approval(n_approved=n_approved, clamp_reasons=clamp_reasons,
                    mode_used=mode_used, inputs={...})
```

### 6.5 AIMD (additive increase, multiplicative decrease)

`alpha` lives in `[0.2, 1.0]`, persisted per campaign in `campaigns.alpha`:
- On any `ABANDONED` event: `alpha = max(0.2, alpha / 2)`. Halve. Fast back-off — this is how the system protects itself when answer rate suddenly drops or agents vanish.
- Per clean pacing interval (no abandonment in the last interval, default 30s): `alpha = min(1.0, alpha + 0.05)`. Slow ramp.

### 6.6 Progressive mode (fallback, also standalone)

```python
def propose_progressive(campaign_id, db) -> int:
    # One dial per available agent, agent-bound. Deterministic.
    A = count(db, agents WHERE status='AVAILABLE' AND campaign_id=campaign_id)
    return A  # safety controller will accept min(n_proposed, A) trivially
```

Progressive dials reserve the agent **first**, then originate. No unbound dials. `n_dials <= A` always.

---

## 7. PROVIDERS — Interface + A/B + Circuit Breaker

### 7.1 Interface (`app/providers/base.py`)

```python
from typing import Protocol, AsyncIterator
from dataclasses import dataclass

@dataclass
class OriginateRequest:
    call_id: str       # our internal call UUID
    borrower_phone: str
    campaign_id: str

@dataclass
class OriginateResult:
    ok: bool
    provider_call_id: str | None
    error: str | None   # 'TIMEOUT' | 'REJECTED' | 'PROVIDER_ERROR'

@dataclass
class CallStatus:
    state: str          # maps to our CallState
    raw: dict

@dataclass
class ProviderEvent:
    event_id: str       # provider's unique event ID (idempotency key)
    provider_call_id: str
    event_type: str     # INITIATED|RINGING|ANSWERED|COMPLETED|FAILED
    payload: dict

class TelecomProvider(Protocol):
    name: str
    async def originate(self, req: OriginateRequest) -> OriginateResult: ...
    async def get_status(self, provider_call_id: str) -> CallStatus: ...
    async def stream_events(self) -> AsyncIterator[ProviderEvent]: ...
```

### 7.2 Provider A (`app/providers/provider_a.py`)

- Fast: originate latency 50–150ms (uniform random).
- Reliable: ~2% failure rate (random `FAILED` instead of `RINGING`).
- No duplicates, no reorder.
- Event sequence: `INITIATED → RINGING → ANSWERED → COMPLETED` (or `FAILED` at any step).
- Use the injected `Clock` and an in-memory event queue. Real I/O is simulated.

### 7.3 Provider B (`app/providers/provider_b.py`) — the chaos provider

Configurable knobs (all settable per-instance, so tests can inject specific chaos):

```python
@dataclass
class ProviderBConfig:
    latency_mean_ms: float = 300
    latency_p95_ms: float = 800
    timeout_prob: float = 0.05         # originate returns Error.TIMEOUT
    failure_prob: float = 0.10          # call transitions to FAILED
    duplicate_event_prob: float = 0.05  # same event_id emitted twice
    reorder_prob: float = 0.05          # events shuffled (COMPLETED before ANSWERED)
```

Implementation notes:
- Use the injected `Clock` for all "sleeps" — never `time.sleep`.
- Maintain an internal event queue per call. To inject reorder, shuffle the queue with probability `reorder_prob` before yielding.
- To inject duplicates, yield the same `event_id` twice with probability `duplicate_event_prob`.
- This is the provider that drives your chaos tests. The dialer must not break.

### 7.4 Circuit Breaker (`app/providers/circuit_breaker.py`)

Wraps every provider. States:
- `CLOSED` — normal operation. Track failure EWMA and latency EWMA (over last N=20 calls).
- `OPEN` — when failure EWMA > 0.3 OR latency p95 > 1000ms. Block all `originate` calls for `cooldown_seconds` (default 30s). The Safety Controller sees this via `breaker.state` and clamps to 0.
- `HALF_OPEN` — after cooldown, allow 1 probe call. If success → `CLOSED`. If fail → `OPEN` for another cooldown.

The dialer never sees breaker internals — it just sees `originate` succeed or fail. Safety Controller queries `breaker.state` to decide.

### 7.5 Import firewall (enforced by test)

```python
# tests/test_import_firewall.py
import importlib
import sys

def test_pacing_does_not_import_providers():
    # Clear any cached provider modules
    for m in list(sys.modules):
        if m.startswith('app.providers'):
            del sys.modules[m]
    # Import pacing modules fresh
    importlib.import_module('app.pacing.predictive')
    importlib.import_module('app.pacing.progressive')
    importlib.import_module('app.pacing.base')
    # Assert no provider modules were loaded as a side effect
    provider_modules = [m for m in sys.modules if m.startswith('app.providers')]
    assert not provider_modules, f"Pacing imported providers: {provider_modules}"
```

Also configure `import-linter` (a real package — add to dev deps) with a contract:
```ini
# .importlinter
[importlinter]
root_package = app

[importlinter:contract:pacing-firewall]
name = Pacing must not import providers
type = forbidden
source_modules = app.pacing
forbidden_modules = app.providers
```

Run `lint-imports` in CI.

---

## 8. FILE STRUCTURE — exact tree

```
smartdialer/
├── ROADMAP.md                       # milestone checklist (provided companion)
├── DECISIONS.md                     # ADR log (provided companion, append-only)
├── ASSUMPTIONS.md                   # anything you guessed
├── BRIEF.md                         # the original assignment (copy from PDF text)
├── README.md                        # local setup, run tests, run sim, run load test
├── ARCHITECTURE.md                  # mermaid diagrams + decision narrative
├── ANSWERS.md                        # final question + scale + drills + least-confident
├── docker-compose.yml               # postgres, api, worker, dashboard
├── pyproject.toml                   # deps: fastapi, sqlalchemy, etc.
├── .importlinter                    # import-linter contract
├── migrations/
│   └── 001_init.sql                  # the schema from §4
├── app/
│   ├── __init__.py
│   ├── main.py                      # FastAPI app: /healthz, /metrics, /api/...
│   ├── config.py                    # env-based config (pydantic-settings)
│   ├── clock.py                      # Clock protocol, SimClock, WallClock
│   ├── db.py                         # async SQLAlchemy engine + session factory
│   ├── domain/
│   │   ├── fsm.py                    # §5 transition tables + transition()
│   │   ├── models.py                 # SQLAlchemy ORM models for all tables
│   │   └── enums.py                  # AgentStatus, CallState, etc.
│   ├── pacing/
│   │   ├── base.py                   # PacingEngine protocol
│   │   ├── progressive.py            # §6.6
│   │   └── predictive.py             # §6.1–6.3, 6.5
│   ├── safety/
│   │   └── controller.py             # §6.4 — the firewall
│   ├── providers/
│   │   ├── base.py                   # TelecomProvider protocol, §7.1
│   │   ├── provider_a.py             # §7.2
│   │   ├── provider_b.py             # §7.3
│   │   ├── circuit_breaker.py        # §7.4
│   │   └── call_allocator.py         # §7 — ONLY file that imports provider clients
│   ├── worker/
│   │   ├── pacing_worker.py          # main loop: tick pacing → safety → allocator
│   │   ├── event_ingest_worker.py    # consume provider events, apply FSM in txn
│   │   └── reaper.py                 # §5/§2.5 — reclaim expired leases
│   ├── api/
│   │   ├── routes.py                 # campaign CRUD, agent login/heartbeat
│   │   ├── events.py                 # provider webhook: POST /api/events/:provider
│   │   └── dashboard_ws.py           # WebSocket: pg LISTEN/NOTIFY → ws push
│   ├── sim/
│   │   ├── clock.py                  # SimClock (deterministic)
│   │   ├── rng.py                    # seeded RNG wrapper
│   │   ├── scenarios.py              # A/B/C/D
│   │   ├── runner.py                 # CLI: python -m app.sim.runner --scenario A --seed 42
│   │   └── reports.py                # JSON + CSV report writers
│   └── observability/
│       ├── logging.py                # structured JSON logger
│       ├── tracing.py                # OpenTelemetry spans (no-op if OTLP unset)
│       └── metrics.py                # /metrics endpoint
├── tests/
│   ├── test_fsm.py                   # legal/illegal/duplicate/terminal
│   ├── test_reservation_concurrency.py  # §M2 DONE: N actors/N agents/exactly N successes
│   ├── test_event_chaos.py           # §M3 DONE: ANSWERED×3,COMPLETED; COMPLETED,ANSWERED,RINGING
│   ├── test_circuit_breaker.py       # opens on injected failures
│   ├── test_safety_property.py       # §M5 DONE: 10k random states, never violate inequality
│   ├── test_import_firewall.py       # pacing imports nothing from providers
│   ├── test_crash_drill.py           # kill -9 worker mid-flow; converge within TTL
│   ├── test_progressive.py           # 50 available → never >50 dials
│   ├── test_predictive.py            # proposal + safety + AIMD
│   └── conftest.py                   # pytest fixtures: test DB, SimClock, mock providers
├── dashboard/                        # Vite React-TS, separate package.json
│   ├── src/
│   │   ├── App.tsx                   # tabs: Agents | Funnel | Pacing
│   │   ├── components/AgentGrid.tsx
│   │   ├── components/CallFunnel.tsx
│   │   ├── components/PacingPanel.tsx
│   │   ├── hooks/useWebSocket.ts
│   │   └── api/client.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
└── scripts/
    ├── load_test.py                  # §M8
    ├── crash_drill.sh                 # §M4: kill -9 a worker mid-flow
    └── run_demo.sh                    # one-shot: compose up + seed + run sim
```

## 9. BUILD SEQUENCE — M0 through M8

Each milestone has: **scope**, **files to create**, **DONE criteria** (test names that must pass). Tick the box in `ROADMAP.md` only when DONE criteria pass.

### M0 — Scaffold
**Scope:** Project skeleton, compose, healthz.
**Files:** `pyproject.toml`, `docker-compose.yml`, `app/main.py` (`/healthz`), `migrations/001_init.sql` (full schema), `app/db.py`, `app/config.py`, `tests/test_healthz.py`.
**DONE:**
- [ ] `docker-compose up` brings up postgres + api, both healthy.
- [ ] `curl localhost:8000/healthz` → `{"status":"ok"}`.
- [ ] `pytest` runs (zero tests is fine, suite must collect cleanly).

### M1 — Domain FSMs + table-driven unit tests
**Scope:** Pure-Python state machines.
**Files:** `app/domain/fsm.py`, `app/domain/enums.py`, `tests/test_fsm.py`.
**DONE:**
- [ ] All legal transitions return correct new state.
- [ ] Illegal transitions return `(current, False)` and never raise.
- [ ] Duplicate terminal events are no-ops.
- [ ] `COMPLETED` is accepted from any active state (convergence).
- [ ] `ANSWERED, ANSWERED, ANSWERED, COMPLETED` → `COMPLETED`.
- [ ] `COMPLETED, ANSWERED, RINGING` → `COMPLETED` (late events dropped).

### M2 — SQLAlchemy models + Reservation Service
**Scope:** ORM models for all tables; atomic agent reservation.
**Files:** `app/domain/models.py`, `app/providers/call_allocator.py` (only `reserve_agent` fn for now), `tests/test_reservation_concurrency.py`.
**Reservation SQL (literal, in `call_allocator.py`):**
```sql
UPDATE agents SET status='RESERVED', reserved_by=:w, reserved_until=now()+interval '30 seconds'
WHERE id = (
  SELECT id FROM agents WHERE status='AVAILABLE'
  ORDER BY last_call_ended_at NULLS FIRST
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING *;
```
**DONE (the critical concurrency test):**
- [ ] Spawn N=10 asyncio tasks (or threads) racing on a pool of N=10 AVAILABLE agents → exactly 10 succeed, 0 collisions.
- [ ] Same test with N=50 tasks on N=10 agents → exactly 10 succeed, 40 get `None`.
- [ ] No agent is double-reserved. Assert via `SELECT count(*) FROM agents WHERE status='RESERVED' == pool_size`.

### M3 — Providers A/B + Event Ingest + Circuit Breaker
**Scope:** Two mock providers, idempotent event ingestion, circuit breaker.
**Files:** `app/providers/base.py`, `provider_a.py`, `provider_b.py`, `circuit_breaker.py`, `app/worker/event_ingest_worker.py`, `tests/test_event_chaos.py`, `tests/test_circuit_breaker.py`.
**Event ingest transaction (literal):**
```sql
BEGIN;
INSERT INTO provider_events (provider, event_id, provider_call_id, event_type, payload)
VALUES (:p, :eid, :cid, :t, :payload)
ON CONFLICT (event_id) DO NOTHING
RETURNING id;
-- If returned (not a duplicate): apply FSM transition to calls row in same txn.
COMMIT;
```
**DONE (chaos convergence):**
- [ ] Sequence `ANSWERED, ANSWERED, ANSWERED, COMPLETED` (with same `provider_call_id`) → final call state `COMPLETED`, 3 duplicates no-op.
- [ ] Sequence `COMPLETED, ANSWERED, RINGING` (reordered) → final call state `COMPLETED`, late events dropped.
- [ ] Worker crashes after `ANSWERED` (simulated by killing txn mid-apply) → re-run converge to `CONNECTED` or `ABANDONED`.
- [ ] Circuit breaker: inject 5 consecutive `originate` failures → breaker transitions `CLOSED → OPEN`, subsequent `originate` calls return `BLOCKED`. After cooldown, `HALF_OPEN` probe succeeds → `CLOSED`.

### M4 — Progressive Dialer Worker + Reaper + Crash Drill
**Scope:** End-to-end progressive dialing, TTL lease reaping, crash recovery.
**Files:** `app/worker/pacing_worker.py`, `app/worker/reaper.py`, `scripts/crash_drill.sh`, `tests/test_crash_drill.py`, `tests/test_progressive.py`.
**Worker loop (per campaign, every 1s, inside `pg_advisory_xact_lock`):**
```
1. PacingEngine.propose_progressive(campaign_id) → n_proposed = count(AVAILABLE agents)
2. SafetyController.approve(campaign_id, n_proposed) → n_approved (will equal n_proposed in clean state)
3. INSERT INTO dial_decisions (...)
4. For i in range(n_approved):
     - call_allocator.dial_progressive(campaign_id):
         a) Reserve agent (atomic SQL from M2)
         b) Reserve borrower (similar SKIP LOCKED pattern on borrowers table)
         c) provider.originate(...) → provider_call_id (or fail → release agent+borrower)
         d) INSERT INTO calls (state='INITIATED', agent_id=..., borrower_id=...)
5. Commit txn (advisory lock released)
```
**Reaper (every 5s):**
```
- Reclaim agents with reserved_until < now(): UPDATE agents SET status='AVAILABLE', reserved_by=NULL, reserved_until=NULL WHERE status IN ('RESERVED','DIALING') AND reserved_until < now()
- Flip heartbeat-stale agents: UPDATE agents SET status='OFFLINE' WHERE last_heartbeat_at < now() - interval '60 seconds' AND status != 'OFFLINE'
- Reconcile stuck calls: for calls in ('INITIATED','RINGING','ANSWERED') with reserved_until < now(): call provider.get_status(), apply FSM transition.
```
**DONE:**
- [ ] 50 available agents → system never creates >50 dials in flight. Assert via `SELECT count(*) FROM calls WHERE state IN ('INITIATED','RINGING') <= 50` at every tick.
- [ ] `scripts/crash_drill.sh`: starts a worker, mid-flow `kill -9`'s it, waits TTL (30s), starts a new worker. Assert: (a) no agent is double-bound, (b) all reserved agents return to AVAILABLE within TTL+5s, (c) stuck calls converge to terminal state via reaper.

### M5 — Predictive Engine + Safety Controller + AIMD + dial_decisions audit
**Scope:** Predictive pacing with the full math from §6, dial decisions audit, property test, import firewall.
**Files:** `app/pacing/predictive.py`, `app/safety/controller.py`, `tests/test_safety_property.py`, `tests/test_predictive.py`, `tests/test_import_firewall.py`, `.importlinter`.
**DONE:**
- [ ] Property test (`hypothesis`): generate 10,000 random valid states (random A in [0,100], R in [0,100], C in [0,100], p_hat in [0.05,0.98], sigma in [0,0.2], alpha in [0.2,1.0]) → for every approval, assert `u*(R+n_approved) + z*sqrt((R+n_approved)*u*(1-u)) <= A + F + 1e-6` (floating-point slack). NEVER violates.
- [ ] Import firewall: `pytest tests/test_import_firewall.py` passes. `lint-imports` passes.
- [ ] AIMD: simulate an ABANDONED event → `alpha` halves. Simulate 10 clean intervals → `alpha` increments by 0.5.
- [ ] `dial_decisions` table has a row per tick with all inputs, `n_proposed`, `n_approved`, `clamp_reasons`. Queryable by `tick_id`.

### M6 — Simulation Harness
**Scope:** Deterministic simulation with scenarios A/B/C/D, JSON+CSV reports.
**Files:** `app/sim/clock.py`, `rng.py`, `scenarios.py`, `runner.py`, `reports.py`.
**CLI:**
```bash
python -m app.sim.runner --scenario A --seed 42 --duration 600
# Outputs:
#   reports/scenario_A_seed42.json   (full event log + dial_decisions trace)
#   reports/scenario_A_seed42.csv    (per-tick: utilization, abandonment, connects, n_proposed, n_approved, clamp_reasons)
```
**Scenarios:**
| Scenario | Answer Rate | Avg Talk Time | Notes |
|---|---|---|---|
| A | 20% | 120s | Low answer, long talk — predictive shines |
| B | 50% | 90s | Balanced |
| C | 70% | 180s | High answer, long talk — stress test for safety |
| D | Drifting (20%→70%→10%) | Drifting (60s→180s) | Provider B degradation mid-run; tests AIMD adaptivity |
**Reports must include:**
- Agent utilization over time (fraction of agents in `CONNECTED` per tick).
- Abandonment rate (per rolling 100-call window).
- Calls initiated, answered, connected, completed counts.
- Pacing decisions trace (last N `dial_decisions` rows).
- Safety controller decisions (clamp reasons histogram).
**DONE:**
- [ ] Same `--seed` always produces identical output (determinism).
- [ ] Scenario A shows higher utilization than progressive-only baseline (compute the baseline by running scenario A in PROGRESSIVE mode and comparing).
- [ ] Scenario D shows alpha dropping after the degradation, then recovering.

### M7 — React Dashboard
**Scope:** One-page React app, tabs, WebSocket via Postgres LISTEN/NOTIFY.
**Files:** `dashboard/` (full Vite React-TS project), `app/api/dashboard_ws.py`.
**Backend:**
- `NOTIFY dial_decision, json_payload` after each `dial_decisions` INSERT.
- `NOTIFY agent_state_change, json_payload` after each agent status transition.
- WebSocket endpoint `GET /ws/dashboard` subscribes to a Postgres LISTEN channel and forwards to client.
**Frontend — 3 tabs:**
1. **Agent State Grid**: live counts by status (OFFLINE / AVAILABLE / RESERVED / DIALING / CONNECTED / WRAP_UP / PAUSED). Color-coded. Updates via WebSocket.
2. **Call Funnel**: QUEUED → RESERVED → INITIATED → RINGING → ANSWERED → CONNECTED → COMPLETED. Shows drop-off counts at each stage. Last 60s window.
3. **Pacing Panel**: table of last N `dial_decisions` rows. Each row shows: timestamp, A, R, C, p_hat, n_proposed, n_approved, clamp_reasons (as badges), mode_used. This is the "why 17 calls?" panel.
**Auth:** simple bearer token in `Authorization` header (env-configured). Demonstrates authn/authz awareness.
**Constraints:** No extra UI libraries beyond `recharts`. TailwindCSS is OK if you must, but plain CSS is fine.
**DONE:**
- [ ] Dashboard loads, connects WebSocket, shows live updates when sim is running.
- [ ] All 3 tabs functional.
- [ ] Pacing panel shows clamp reasons as visible badges.

### M8 — Load Test + Docs
**Scope:** Load test script, README, ARCHITECTURE.md (mermaid), ANSWERS.md.
**Files:** `scripts/load_test.py`, `README.md`, `ARCHITECTURE.md`, `ANSWERS.md`.
**Load test:**
```bash
python scripts/load_test.py --workers 8 --agents 1000 --duration 60
# Output: reports/load_test.json
{
  "reservation_p50_ms": ..., "reservation_p95_ms": ...,
  "event_apply_p50_ms": ..., "event_apply_p95_ms": ...,
  "dial_cycle_p50_ms": ..., "dial_cycle_p95_ms": ...,
  "ops_per_sec": ...,
  "bottleneck_observation": "..."
}
```
Spawn N worker processes against a synthetic agent pool. Measure p50/p95 of: agent reservation, event apply, full dial cycle. Identify the bottleneck in the observation field.
**README.md must include:**
- One-line summary.
- `docker-compose up` quickstart.
- How to run tests, sim, load test, dashboard.
- Link to ARCHITECTURE.md.
**ARCHITECTURE.md must include:**
- C4 Context diagram (mermaid).
- Container diagram (mermaid).
- Component diagram (mermaid).
- Sequence diagram for a predictive dial decision (mermaid).
- Decision narrative (3–5 paragraphs): why Postgres-only, why SKIP LOCKED, why the pacing/safety/allocator firewall, why injected clock.
**ANSWERS.md must include** (see §15 below for the 4 required answers):
1. Final question: how to get predictive utilization with deterministic progressive safety.
2. Scale: what breaks first at 100 → 1,000 → 10,000 agents.
3. The 5 failure drills from BRIEF.md with observed outcomes and code locations.
4. "Least confident part" — one honest paragraph.
**DONE:**
- [ ] Load test runs, produces JSON with p50/p95 and a bottleneck observation.
- [ ] README has working quickstart.
- [ ] ARCHITECTURE.md has 4 mermaid diagrams that render correctly.
- [ ] ANSWERS.md has all 4 answers, each ≥150 words (except the "least confident" which can be a paragraph).

---

## 10. TESTS — Mandatory test suite (single source of truth)

Every test below must exist and pass. This is non-negotiable.

| Test file | What it asserts | Milestone |
|---|---|---|
| `tests/test_fsm.py` | Legal/illegal/duplicate/terminal transitions for both FSMs. Convergence rules. | M1 |
| `tests/test_reservation_concurrency.py` | N racing actors on N agents → exactly N successes, 0 double-reservations. | M2 |
| `tests/test_event_chaos.py` | `ANSWERED×3, COMPLETED` and `COMPLETED, ANSWERED, RINGING` converge correctly. Worker-crash-after-ANSWERED converges. | M3 |
| `tests/test_circuit_breaker.py` | Breaker opens on injected failures; HALF_OPEN probe; recovers to CLOSED. | M3 |
| `tests/test_progressive.py` | 50 available agents → never >50 in-flight dials at any tick. | M4 |
| `tests/test_crash_drill.py` | `kill -9` mid-flow → converge within TTL, no double-binding. | M4 |
| `tests/test_predictive.py` | Proposal formula correctness; AIMD halving on ABANDONED, ramping on clean interval. | M5 |
| `tests/test_safety_property.py` | 10k hypothesis-generated random states → approved n NEVER violates the binomial-safety inequality. | M5 |
| `tests/test_import_firewall.py` | Pacing modules import nothing from `app.providers`. | M5 |
| `tests/conftest.py` | Fixtures: ephemeral test DB, SimClock, mock providers, seed campaigns. | All |

**Property test sketch (`tests/test_safety_property.py`):**
```python
from hypothesis import given, strategies as st, settings

@given(
    A=st.integers(min_value=0, max_value=200),
    R=st.integers(min_value=0, max_value=200),
    C=st.integers(min_value=0, max_value=200),
    p_hat=st.floats(min_value=0.05, max_value=0.98),
    sigma_hat=st.floats(min_value=0.0, max_value=0.2),
    alpha=st.floats(min_value=0.2, max_value=1.0),
    d_hat=st.floats(min_value=1.0, max_value=30.0),
    h_hat=st.floats(min_value=10.0, max_value=300.0),
)
@settings(max_examples=10000)
def test_safety_never_violates_binomial_bound(A, R, C, p_hat, sigma_hat, alpha, d_hat, h_hat):
    decision = safety_controller.approve_pure(n_proposed=10**6, A=A, R=R, C=C,
                                              p_hat=p_hat, sigma_hat=sigma_hat,
                                              alpha=alpha, d_hat=d_hat, h_hat=h_hat)
    n = decision.n_approved
    u = clamp(p_hat + 2*sigma_hat, 0.05, 0.98)
    z = 2.33
    lhs = u * (R + n) + z * math.sqrt((R + n) * u * (1 - u))
    F = C * min(1.0, d_hat / max(h_hat, 1.0))
    rhs = A + F
    assert lhs <= rhs + 1e-6, f"VIOLATION: n={n}, lhs={lhs}, rhs={rhs}, inputs={...}"
```

---

## 11. SIMULATION HARNESS (M6 — detailed spec)

**SimClock (`app/sim/clock.py`):**
```python
class SimClock:
    def __init__(self, start: float = 0.0):
        self._t = start
    def now(self) -> float: return self._t
    def advance(self, dt: float) -> None: self._t += dt
    def sleep(self, dt: float, async_ctx) -> None:
        # In sim mode, advance the clock instead of actually sleeping.
        self._t += dt
```

**Seeded RNG (`app/sim/rng.py`):**
```python
import random
class SeededRNG:
    def __init__(self, seed: int): self._r = random.Random(seed)
    def answer(self) -> bool: return self._r.random() < self._answer_rate
    def latency_ms(self, mean: float, p95: float) -> float: ...  # lognormal fit
```

**Scenarios (`app/sim/scenarios.py`):**
- A: `answer_rate=0.20, talk_time=120, provider='A', drift=None`
- B: `answer_rate=0.50, talk_time=90, provider='A'`
- C: `answer_rate=0.70, talk_time=180, provider='A'`
- D: drifting answer_rate `[0.20 → 0.70 → 0.10]` over 10 minutes, talk_time drifting `[60 → 180]`, switches to Provider B at minute 5 with `failure_prob=0.15`.

**Runner (`app/sim/runner.py`):**
- CLI: `python -m app.sim.runner --scenario A --seed 42 --duration 600 --agents 50`
- Boots in-memory worker(s), SimClock, mocked providers, simulated agents (background task that logs in, takes calls, wraps up).
- After run, writes:
  - `reports/scenario_<X>_seed<S>.json` — full event stream + all `dial_decisions` rows + summary stats.
  - `reports/scenario_<X>_seed<S>.csv` — per-tick rows: `tick_id, ts, A, R, C, p_hat, n_proposed, n_approved, clamp_reasons, utilization, abandonment_rate`.

---

## 12. REACT DASHBOARD (M7 — detailed spec)

**Backend (`app/api/dashboard_ws.py`):**
```python
@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket, token: str = Depends(verify_token)):
    await websocket.accept()
    # Listen to Postgres NOTIFY channels:
    #   - dial_decision
    #   - agent_state_change
    #   - call_state_change
    # Forward each notification JSON to the websocket.
    async with pg_connection() as conn:
        await conn.add_listener('dial_decision', lambda *args: asyncio.create_task(
            websocket.send_text(args[3])
        ))
        # ... same for other channels ...
        while True:
            await asyncio.sleep(1)  # keep alive
```

**Frontend (`dashboard/src/`):**
- `App.tsx`: tab switcher (Agents | Funnel | Pacing), WebSocket hook.
- `hooks/useWebSocket.ts`: connects to `/ws/dashboard`, dispatches messages to the right tab.
- `components/AgentGrid.tsx`: 7 status pills with live counts (use `recharts` PieChart or just colored divs).
- `components/CallFunnel.tsx`: horizontal bar chart of call counts per state.
- `components/PacingPanel.tsx`: table of last 20 `dial_decisions`. Each row: `ts | A | R | C | p̂ | n_prop | n_appr | clamp_reasons (badges) | mode`.
- `api/client.ts`: optional REST fallback (`GET /api/dial_decisions?limit=20`) for initial load before WS connects.

**Auth (lightweight):**
- Env var `DASHBOARD_TOKEN`. WebSocket requires `?token=<value>` query param or `Authorization: Bearer <value>` header.
- Demonstrates authn/authz awareness — covers the "auth and permissions" AI-engineering topic from your background.

---

## 13. LOAD TEST (M8 — detailed spec)

**Script (`scripts/load_test.py`):**
```python
# Pseudo:
# 1. Spin up N=8 worker processes (multiprocessing), each running pacing_worker against a shared Postgres.
# 2. Seed 1000 agents, 10000 borrowers, 1 campaign in PREDICTIVE mode.
# 3. Run for 60s wall clock.
# 4. Each worker records latency of: reservation SQL, event apply SQL, full dial cycle.
# 5. Aggregate p50/p95 across all workers.
# 6. Compute ops/sec (calls initiated per second).
# 7. Write JSON report + observation string.
```

**Expected bottleneck observation** (your honest read of the actual run):
- At 100 agents: nothing breaks.
- At 1,000 agents: `COUNT(*)` queries on `calls` start showing up in p95. Hot-row contention on the `idx_agents_available` partial index.
- At 10,000 agents: write throughput on `provider_events` and `dial_decisions` becomes the limiter. `COUNT(*)` is unacceptable — switch to maintained counters (see ANSWERS.md §2).

The load test doesn't need to actually run 10k agents — it needs to identify *where* the bottleneck would be. The observation field in the JSON output is the answer.

---

## 14. DELIVERABLES — README, ARCHITECTURE.md, ANSWERS.md

### 14.1 README.md (concise, runnable)

```markdown
# SmartDialer — CredResolve Collections Dialer Prototype

A progressive + predictive outbound dialer with a Safety Controller firewall.
Built for the CredResolve Hiring 2026 tech assignment.

## Quickstart
docker-compose up -d
docker-compose exec api alembic upgrade head   # or: psql -f migrations/001_init.sql
pytest
python -m app.sim.runner --scenario A --seed 42
cd dashboard && npm install && npm run dev   # http://localhost:5173
python scripts/load_test.py --workers 8 --agents 1000 --duration 60

## Architecture
See ARCHITECTURE.md for diagrams + decision narrative.

## Answers
See ANSWERS.md for the final question, scale analysis, failure drills, and least-confident part.
```

### 14.2 ARCHITECTURE.md (mermaid diagrams)

Must contain 4 mermaid diagrams that render on GitHub:
1. **C4 Context** — SmartDialer ↔ Collections Agents ↔ Telecom Provider ↔ Borrowers ↔ Banks.
2. **Container** — Postgres, API (FastAPI), Worker, Reaper, Dashboard (React).
3. **Component** — PacingEngine → SafetyController → CallAllocator → Provider (with circuit breaker).
4. **Sequence** — a single predictive dial decision from tick to provider.originate.

Plus 3–5 paragraphs of decision narrative answering: What did you choose? Why? What problem does it solve? What does it make harder?

### 14.3 ANSWERS.md (the 4 required answers)

**Answer 1 — Final question (≥200 words):**
> How would you build a SmartDialer that gets as much of the utilization benefit of predictive dialing as possible, while retaining the deterministic safety characteristics of progressive dialing?

Answer outline:
- **Risk-bounded dialing.** The pacing engine proposes; the Safety Controller clamps via the binomial-safety inequality `u*(R+n) + z*sqrt((R+n)*u*(1-u)) <= A+F`. This makes the probability of over-answer bounded to the 99th percentile under the worst-case pessimistic answer rate `u = p_hat + 2*sigma_hat`. We never dial more than the math allows.
- **Atomic-attach-or-abandon.** When a predictive (unbound) call's ANSWERED event arrives, we attempt to bind an agent atomically via `UPDATE agents SET status='CONNECTED' WHERE id=(... SKIP LOCKED ...) AND status='AVAILABLE'`. If a row returns → CONNECTED. If empty → after a short grace period (3s) the call is ABANDONED, which feeds AIMD (halve alpha). The system silently degrades toward progressive as confidence drops.
- **Silent degradation floor to exact progressive.** When metrics are stale, abandonment rate exceeds 3%, or the provider circuit is OPEN, the Safety Controller forces progressive mode (`mode_used='PROGRESSIVE'`, `n_approved <= A`). The pacing engine cannot disable this. So the floor is: "worst case, we behave exactly like progressive dialing."
- The key insight: deterministic safety is not a property of the *algorithm*, it's a property of the *architecture*. The Safety Controller is the architectural guarantee; the math is just the tightest bound we can compute. Even if the math is wrong, the floor holds.

**Answer 2 — Scale (≥250 words):**
> What breaks first at 100 → 1,000 → 10,000 agents? How would you fix it?

Answer outline:
- **100 agents:** Nothing breaks. Single Postgres instance handles the load trivially. COUNT(*) on `calls` is fast.
- **1,000 agents:** Two things start showing up:
  1. `COUNT(*)` queries in the Safety Controller (A, R, C) hit p95 ~50ms because the `calls` table grows. Fix: maintained counters — add `agents_available_count`, `calls_in_flight_count` columns to `campaigns` (or a separate `campaign_metrics` table), updated by trigger or by the worker that performs the transition. Trade-off: counters can drift; reconcile nightly.
  2. Hot-row contention on `idx_agents_available` when many workers race the SKIP LOCKED query. Fix: batched reservation (reserve K agents per worker tick instead of 1), reducing lock churn.
- **10,000 agents:** The bottleneck is **Postgres write throughput**, not CPU. `provider_events` and `dial_decisions` become write-heavy. Fixes in order:
  1. **Maintained counters** (above) — eliminates COUNT(*).
  2. **Batched event commits** — accumulate 50–100 events per transaction instead of 1.
  3. **Partitioned event tables** — partition `provider_events` by `received_at` day. Old partitions can be detached/archived.
  4. **Dashboard rollups** — instead of LISTEN/NOTIFY per row, aggregate to per-second metrics and push those.
  5. **Outbox → queue (only if still short)** — if Postgres write throughput is still the limiter, introduce an outbox pattern: write events to an `outbox` table in the same txn, a separate process drains it to Kafka/Redis. **This is the last resort, not the first move.** The PDF explicitly warns against adding tech just because it sounds impressive.
- The CPU on workers is never the bottleneck — pacing is cheap. The DB is.

**Answer 3 — The 5 failure drills (each ~100 words):**
1. **Worker crash (Agent reserved → Borrower reserved → Call initiated → Worker crashes):** TTL lease on the agent reservation expires after 30s. Reaper reclaims it, sets `status='AVAILABLE'`. The call's `reserved_until` also expires; reaper calls `provider.get_status()` to reconcile — if the call was actually answered but no worker processed it, it transitions to `ABANDONED` (feeds AIMD) or `CONNECTED` if an agent is bound. Code: `app/worker/reaper.py`, `tests/test_crash_drill.py`.
2. **Provider outage (starts timing out):** Circuit breaker (`app/providers/circuit_breaker.py`) detects failure EWMA > threshold, transitions `CLOSED → OPEN`. Safety Controller sees `breaker.state == 'OPEN'`, sets `n_approved=0`, `clamp_reasons=['circuit_open']`. No new calls placed. Existing calls continue to flow through events (or get reconciled by reaper if events stop). After 30s cooldown, `HALF_OPEN` probes one call; if success → `CLOSED`.
3. **Agent availability drops (100 → 60 in seconds):** The next pacing tick recomputes A from the DB (the reaper flipped the missing agents to OFFLINE due to stale heartbeats). `n_proposed = floor(alpha * (A+F) / p_hat)` drops accordingly. Safety Controller's binomial bound `(R+n) <= (A+F)/u` further clamps. Within 1 tick (1 second) the dialer is dialing at the new safe rate. No code path needed beyond "recompute from DB every tick" — which is already invariant #3.
4. **Duplicate events:** `provider_events.event_id` has a UNIQUE constraint. `INSERT ... ON CONFLICT (event_id) DO NOTHING` returns no row, so the FSM transition is skipped. Idempotent. Code: `app/worker/event_ingest_worker.py`.
5. **Out-of-order events:** Pure-Python FSM `transition()` returns `(current, False)` for any event that's illegal given the current state — including late events on a terminal call. `COMPLETED` is accepted from any active state (convergence rule). Late `ANSWERED` after `COMPLETED` is log-and-ignored. Code: `app/domain/fsm.py`, `tests/test_event_chaos.py`.

**Answer 4 — Least confident part (one honest paragraph, ~150 words):**
> The part I'm least confident about is the EWMA estimator for `sigma_hat` (answer-rate variance). EWMA is a reasonable first approximation, but it lags true variance during regime shifts (e.g., when answer rate drops from 70% to 10% in scenario D). The `+2*sigma` upper bound in the safety controller becomes loose during the lag, meaning the dialer is more conservative than necessary for a few seconds after a regime shift — slightly hurting utilization. A proper fix would be a sliding-window variance with change-point detection, or a Bayesian Beta-Binomial model with a prior that adapts. I chose EWMA because it's stateless, persists in one row per campaign, and is trivially explainable in an interview. The cost: suboptimal utilization during sharp regime changes, which the AIMD halving on ABANDONED partly compensates for.

---

## 15. AI-ENGINEERING EXTENSIONS — Demonstrate breadth

This section maps your background (system design, observability, security, cost optimization, guardrails, feedback loops, TTL environments) to concrete places in the system. These aren't extra features — they're framing for the live discussion.

| Your strength | Where it shows up in the build | How to discuss it |
|---|---|---|
| **System design & architecture** | §3 pipeline, ARCHITECTURE.md mermaid diagrams, the pacing/safety/allocator firewall | "I treat the firewall between estimates and dialing as the primary architectural invariant. Every other decision flows from there." |
| **APIs & backend logic** | FastAPI routes (`/api/campaigns`, `/api/agents/heartbeat`, `/api/events/:provider`, `/ws/dashboard`), idempotent event ingest | "Event ingestion is one transaction with ON CONFLICT DO NOTHING — exactly-once semantics without a message broker." |
| **Auth & permissions** | Dashboard bearer token (§12); provider credentials via env (not hardcoded) | "Provider API keys live in env vars, never in code. Dashboard auth is a simple bearer token in the prototype; production would use short-lived JWTs." |
| **Hosting & cloud** | docker-compose for local; note in ARCHITECTURE.md that production deployment is a containerized FastAPI + Postgres (RDS), workers as ECS/K8s jobs | "The compose file IS the deployment manifest. Add a Helm chart or ECS task def and you're in prod." |
| **Version control** | Conventional commits per milestone (`feat(M2): reservation service`), `DECISIONS.md` ADR log | "Every non-obvious decision is logged as an ADR. Anyone joining the project can read DECISIONS.md and understand why." |
| **Caching & CDN** | Not in prototype (state must survive crash → DB only). Note in ANSWERS.md §2 that maintained counters are the production caching layer (in-DB, not Redis) | "I deliberately don't cache state in Redis — the DB is the source of truth. Caching is for read paths (dashboard rollups), not write paths." |
| **Error tracking & logs** | Structured JSON logs (`app/observability/logging.py`), trace_id/span_id propagation | "Every log line is JSON with trace_id. You can grep a single dial decision across all components." |
| **Monitoring & alert** | `/metrics` endpoint (Prometheus-style), `safety_clamps_total{reason}` counter, `agent_state{status}` gauge | "Alert on `safety_clamps_total{reason='circuit_open'}` increasing — that means the provider is failing. Alert on `agent_state{status='OFFLINE'}` spikes — agents are dropping." |
| **Observability & tracing** | OpenTelemetry spans on every pacing tick and provider call (`app/observability/tracing.py`) | "A pacing tick is a span. A provider.originate is a child span. You can trace a single dial decision from proposal to call placement." |
| **Security (prompt injection)** | N/A in the dialer core (no LLM). If you add an LLM-based borrower prioritizer later, sanitize all borrower data before it touches the model. Note in ASSUMPTIONS.md. | "The dialer is rule-based, so prompt injection isn't applicable. If we add an LLM for borrower prioritization, the input sanitization layer goes in `app/domain/borrower_priority.py`." |
| **API Gateway** | Not in prototype. Mention in ARCHITECTURE.md as production extension (rate-limit per provider, auth at gateway). | "Production adds an API gateway (Kong/Envoy) for rate-limiting provider webhooks and centralizing auth." |
| **Cost optimization** | Maintained counters vs COUNT(*), batched event commits (ANSWERS.md §2) | "The cheapest query is the one you don't run. Maintained counters eliminate COUNT(*) at scale." |
| **User feedback loops** | Simulation scenarios A/B/C/D ARE the feedback loop — run sim, observe reports, tune alpha_ewma and thresholds | "The sim harness is the user feedback loop. Product says 'utilization is too low' → run scenario A, look at clamp_reasons, tune." |
| **Guardrails** | Safety Controller IS the guardrail. AIMD is the self-tuning guardrail. Import firewall is the architectural guardrail. | "The system has three guardrails: architectural (import firewall), runtime (Safety Controller), and adaptive (AIMD). All three are testable." |
| **TTL environment** | Leases on every claim (agent reservation, dial task, event job). Reaper reclaims. | "Every claim has a TTL. The reaper is the garbage collector. This is the TTL environment pattern applied to a dialer." |

---

## 16. SESSION PROTOCOL & CREDIT DISCIPLINE

### 16.1 Session protocol (single-shot MVP version)

Since you chose a single agentic session covering M0–M8, the protocol is:
1. Read this prompt fully.
2. Read BRIEF.md (the assignment text — copy from the PDF you were given).
3. Create `ROADMAP.md`, `DECISIONS.md`, `ASSUMPTIONS.md` (Step 0).
4. Create a TODO list reflecting M0–M8 milestones.
5. Build M0. Run its tests. Tick its checkboxes. Commit.
6. Build M1. Run its tests. Tick. Commit.
7. ... continue through M8.
8. Append decisions to `DECISIONS.md` as you make them.
9. Print final status summary (≤15 lines).

**If you hit a context limit or the user pauses you:** use the resume prompt in §17.

### 16.2 Credit discipline (hard rules)

- **Targeted diffs only.** NEVER regenerate an entire file to change a few lines. Use `Edit`/`MultiEdit`.
- **Create only files the current milestone references.** Zero speculative code.
- **Run narrow tests during dev** (`pytest -k <module>`). Full suite only at milestone boundaries.
- **Grep before reading files.** Never re-read the whole codebase.
- **When choosing between options:** pick the simpler one, log it in `DECISIONS.md`, move on. Do not ask open-ended questions.
- **Dependencies:** see §0.9. No extras.
- **One phase per commit.** Commit message format: `feat(M<n>): <short description>`.

### 16.3 Style

- Production-grade but minimal. No toy examples, no commented-out code, no `TODO: implement later`.
- Type hints everywhere (`from __future__ import annotations` at top of every module).
- Docstrings on every public function — one sentence is fine if the function is self-explanatory.
- Tests are first-class citizens — they live in `tests/` and have the same naming conventions as the modules they test.

---

## 17. RESUME PROMPT (if context limit hit)

If Antigravity hits its context limit mid-build, paste this short prompt to resume:

```
Read ROADMAP.md, DECISIONS.md (last 10 lines), and ASSUMPTIONS.md in the smartdialer/ project.
Find the first unchecked phase in ROADMAP.md.
Build ONLY that phase. Run its tests. Commit. Tick its checkboxes.
Append decisions to DECISIONS.md.
Then STOP with a ≤15-line status summary.
Do not start a second phase in this session.
```

This keeps the multi-session discipline without losing the single-shot MVP intent.

---

## 18. FINAL CHECKLIST — verify before declaring done

Before you print the final status summary, verify every box:

- [ ] All M0–M8 milestones ticked in `ROADMAP.md`.
- [ ] All tests in §10 pass: `pytest -v` is green.
- [ ] `lint-imports` passes (import firewall).
- [ ] `docker-compose up` works end-to-end.
- [ ] `python -m app.sim.runner --scenario A --seed 42` produces JSON + CSV reports.
- [ ] Dashboard loads at `http://localhost:5173`, WebSocket connects, all 3 tabs work.
- [ ] `scripts/load_test.py --workers 8 --agents 1000 --duration 60` produces JSON report with p50/p95 and bottleneck observation.
- [ ] `README.md`, `ARCHITECTURE.md` (with 4 mermaid diagrams), `ANSWERS.md` (4 answers) all exist and are complete.
- [ ] `DECISIONS.md` has at least 10 ADR entries covering: Postgres-only, SKIP LOCKED, injected clock, import firewall, EWMA choice, AIMD parameters, circuit breaker thresholds, etc.
- [ ] `ASSUMPTIONS.md` documents anything you guessed.

Then print:

```
SMARTDIALER BUILD COMPLETE
=========================
Milestones: M0 ✓ M1 ✓ M2 ✓ M3 ✓ M4 ✓ M5 ✓ M6 ✓ M7 ✓ M8 ✓
Tests: <N> passed, 0 failed
Demo: docker-compose up && python -m app.sim.runner --scenario A --seed 42
Dashboard: http://localhost:5173
Reports: reports/scenario_A_seed42.{json,csv}
Load test: reports/load_test.json
Docs: README.md, ARCHITECTURE.md, ANSWERS.md
```

You're done. The user can now defend this in the CredResolve technical discussion.

