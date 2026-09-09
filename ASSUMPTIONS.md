# ASSUMPTIONS.md — SmartDialer Architecture & Implementation Assumptions

This document records all engineering assumptions made during the design and implementation of the CredResolve SmartDialer prototype. In accordance with the prompt execution contract, no open-ended questions are asked; all engineering trade-offs and domain assumptions are explicitly logged here.

---

### A1: Workspace Root and Directory Layout
- **Assumption:** The project root is the current workspace directory (`d:\CRED_RESOLVE`), with all project subdirectories (`app/`, `tests/`, `migrations/`, `dashboard/`, `scripts/`, `reports/`) placed directly under the workspace root.
- **Rationale:** Keeps configuration files (`pyproject.toml`, `docker-compose.yml`, `ROADMAP.md`, `DECISIONS.md`) unified with IDE and CI tooling without unnecessary subfolder nesting.

### A2: Database Engine Support (PostgreSQL & SQLite for Testing)
- **Assumption:** PostgreSQL 16+ is the single source of truth in production and integration environments, using `FOR UPDATE SKIP LOCKED`, advisory locks (`pg_advisory_xact_lock`), and `LISTEN/NOTIFY`. For fast isolated unit tests and simulation runs, the ORM and domain layers can run with SQLite in-memory or Postgres (via `TEST_DATABASE_URL`), while concurrency tests requiring `SKIP LOCKED` validate against Postgres.
- **Rationale:** Ensures local developer speed (`pytest` running sub-second unit tests) while retaining 100% fidelity to the Postgres-only invariants for distributed concurrency.

### A3: Clock Abstraction (`Clock`)
- **Assumption:** Domain logic (pacing, FSM, safety clamps, reaper, circuit breaker) accesses time strictly through the `Clock` protocol. `SimClock` advances deterministically by tick/event in simulation; `WallClock` uses `datetime.now(timezone.utc)` in live runs.
- **Rationale:** Enforces deterministic simulation outcomes for identical seeds (M6) and allows time-travel testing for TTL lease expirations (M4).

### A4: Circuit Breaker Parameters & Failure Windows
- **Assumption:** Circuit breaker maintains an EWMA of call failure rate and P95 latency over a rolling sample window (default N=20). Tripping threshold: `failure_ewma > 0.3` OR `latency_p95 > 1000ms`. When tripped, breaker status enters `OPEN` for 30s cooldown before allowing 1 probe call in `HALF_OPEN`.
- **Rationale:** Protects downstream telephony carriers from cascade retries during outages while allowing fast automated recovery.

### A5: Security and Input Sanitization (LLM / Future Scope)
- **Assumption:** The SmartDialer core is rule-based and statistical (EWMA + quadratic binomial bound); no generative LLM is placed in the critical dialing loop. If an AI borrower prioritizer or conversational voice agent is added later, strict input validation and prompt sanitization boundaries must reside in `app/domain/borrower_priority.py`.
- **Rationale:** Prevents prompt injection attacks against borrower database records or collection dispositions.

### A6: Dashboard Token Authentication
- **Assumption:** Dashboard WebSocket and API endpoints validate a shared bearer token configured via `DASHBOARD_TOKEN` (default: `credresolve-secret-2026`).
- **Rationale:** Demonstrates authn/authz security posture without introducing complex OAuth/OIDC infrastructure for a prototype.

### A7: Atomic Attach Grace Period for Predictive Mode
- **Assumption:** When a predictive (unbound) call's `ANSWERED` event arrives, the system attempts atomic agent reservation via `UPDATE agents SET status='CONNECTED' ... WHERE status='AVAILABLE' ... FOR UPDATE SKIP LOCKED`. If no agent is immediately free, a 3-second grace window allows ringing/available agents to finish wrap-up before transitioning the call to `ABANDONED` to strictly limit compliance violations.
- **Rationale:** Complies with RBI fair-practices debt collection codes and TRAI telemarketing regulations against prolonged silence/abandoned borrower connections.
