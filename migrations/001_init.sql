-- 001_init.sql - SmartDialer Core Schema

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PROGRESSIVE','PREDICTIVE')),
  provider TEXT NOT NULL CHECK (provider IN ('A','B')),
  alpha REAL NOT NULL DEFAULT 0.5 CHECK (alpha >= 0.2 AND alpha <= 1.0),
  p_hat REAL NOT NULL DEFAULT 0.3,
  d_hat REAL NOT NULL DEFAULT 8.0,
  h_hat REAL NOT NULL DEFAULT 120.0,
  sigma_hat REAL NOT NULL DEFAULT 0.1,
  last_abandoned_at TIMESTAMPTZ,
  clean_intervals_since_abandon INT NOT NULL DEFAULT 0,
  progressive_cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN
    ('OFFLINE','AVAILABLE','RESERVED','DIALING','CONNECTED','WRAP_UP','PAUSED')),
  reserved_by TEXT,
  reserved_until TIMESTAMPTZ,
  last_call_ended_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_available ON agents (last_call_ended_at NULLS FIRST)
  WHERE status = 'AVAILABLE';

CREATE TABLE IF NOT EXISTS borrowers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  phone TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  call_count INT NOT NULL DEFAULT 0,
  last_called_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_borrowers_campaign_priority
  ON borrowers (campaign_id, priority DESC, last_called_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  borrower_id UUID REFERENCES borrowers(id),
  agent_id UUID REFERENCES agents(id),
  provider TEXT NOT NULL,
  provider_call_id TEXT,
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN
    ('QUEUED','RESERVED','INITIATED','RINGING','ANSWERED','CONNECTED',
     'COMPLETED','FAILED','CANCELLED','ABANDONED')),
  reserved_by TEXT,
  reserved_until TIMESTAMPTZ,
  initiated_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_state ON calls (state);
CREATE INDEX IF NOT EXISTS idx_calls_provider_call_id ON calls (provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_campaign_state ON calls (campaign_id, state);

CREATE TABLE IF NOT EXISTS provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  provider_call_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_events_call ON provider_events (provider_call_id);
CREATE INDEX IF NOT EXISTS idx_provider_events_unprocessed ON provider_events (received_at);

CREATE TABLE IF NOT EXISTS dial_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  tick_id BIGINT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  agents_available INT NOT NULL,
  calls_initiated_or_ringing INT NOT NULL,
  calls_answered_or_connected INT NOT NULL,
  p_hat REAL NOT NULL,
  d_hat REAL NOT NULL,
  h_hat REAL NOT NULL,
  f_available REAL NOT NULL,
  alpha REAL NOT NULL,
  provider_circuit TEXT NOT NULL,
  n_proposed INT NOT NULL,
  n_approved INT NOT NULL,
  clamp_reasons TEXT[] NOT NULL DEFAULT '{}',
  mode_used TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dial_decisions_campaign_tick ON dial_decisions (campaign_id, tick_id);

CREATE TABLE IF NOT EXISTS leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  holder TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leases_expires ON leases (expires_at) WHERE NOT released;
