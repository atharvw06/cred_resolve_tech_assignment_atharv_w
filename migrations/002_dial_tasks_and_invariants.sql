-- 002_dial_tasks_and_invariants.sql
-- Hardened entities for durable task queues, borrower lifecycle, and immutable audit logs

-- 1. Extend Borrowers with suppression, retry policies, and lease claims
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS reserved_by TEXT;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_borrowers_eligible
  ON borrowers (campaign_id, priority DESC, last_called_at NULLS FIRST)
  WHERE NOT suppressed;

-- Partial unique constraint ensuring a borrower has at most ONE active call across the campaign
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_call_per_borrower
  ON calls (borrower_id)
  WHERE state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED');

-- 2. Durable Dial-Task Table (Decoupled from campaign decision lock)
CREATE TABLE IF NOT EXISTS dial_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  decision_id UUID REFERENCES dial_decisions(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN
    ('PENDING', 'PROCESSING', 'DISPATCHED', 'FAILED', 'RECONCILING', 'CANCELLED')),
  agent_id UUID REFERENCES agents(id),
  borrower_id UUID REFERENCES borrowers(id),
  call_id UUID REFERENCES calls(id),
  claimed_by TEXT,
  claimed_until TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  provider_call_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dial_tasks_pending
  ON dial_tasks (campaign_id, created_at)
  WHERE state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_dial_tasks_claimed
  ON dial_tasks (claimed_until)
  WHERE state = 'PROCESSING';

-- 3. Audit Event Log Table (Immutable system & operator actions)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL', 'SUCCESS')),
  actor TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_campaign_created
  ON audit_events (campaign_id, created_at DESC);

-- 4. Provider Health Snapshot Log (Circuit Breaker & Telemetry)
CREATE TABLE IF NOT EXISTS provider_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  circuit_state TEXT NOT NULL CHECK (circuit_state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  latency_p95_ms REAL NOT NULL,
  failure_rate_ewma REAL NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_health_recorded
  ON provider_health_snapshots (provider, recorded_at DESC);
