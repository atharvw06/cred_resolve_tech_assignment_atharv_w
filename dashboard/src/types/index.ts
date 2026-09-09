// Core Domain and UI Types for CredResolve SmartDialer Mission Control

export type AgentStatus =
  | 'AVAILABLE'
  | 'CONNECTED'
  | 'DIALING'
  | 'WRAP_UP'
  | 'RESERVED'
  | 'PAUSED'
  | 'OFFLINE';

export interface AgentRecord {
  id: string;
  name: string;
  team: 'Alpha Recovery' | 'Beta Retention' | 'Gamma Outbound';
  status: AgentStatus;
  timeInStatusSec: number;
  callsHandled: number;
  connectedCalls: number;
  connectRatePct: number;
  avgHandlingTimeSec: number;
  wrapUpTimeSec: number;
  occupancyPct: number;
  lastActivity: string;
  hasWarning?: boolean;
  warningReason?: string;
}

export interface FunnelMetrics {
  QUEUED: number;
  RESERVED: number;
  INITIATED: number;
  RINGING: number;
  ANSWERED: number;
  CONNECTED: number;
  COMPLETED: number;
  FAILED: number;
  ABANDONED: number;
}

export interface DecisionRow {
  id: string;
  tick_id: number;
  decided_at: string;
  actor?: string;
  category?: 'SAFETY_CONTROLLER' | 'AIMD_TUNING' | 'OPERATOR_ACTION' | 'CIRCUIT_BREAKER';
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  A: number;
  R: number;
  C: number;
  p_hat: number;
  d_hat: number;
  h_hat: number;
  f_available: number;
  alpha: number;
  provider_circuit: string;
  n_proposed: number;
  n_approved: number;
  clamp_reasons: string[];
  mode_used: string;
  reason?: string;
}

export interface TimeSeriesPoint {
  time: string;
  timestamp: number;
  utilization: number;
  abandonmentRate: number;
  offered: number;
  dialed: number;
  answered: number;
  connected: number;
  abandoned: number;
  completed: number;
}

export type PacingMode = 'PREDICTIVE' | 'PROGRESSIVE';
export type ScenarioKey = 'A' | 'B' | 'C' | 'D';
export type TimeRange = '5m' | '15m' | '30m' | '1h' | 'today';

export interface GlobalFilters {
  timeRange: TimeRange;
  campaign: string;
  queue: string;
  carrier: string;
  team: string;
  scenario: ScenarioKey;
  searchQuery: string;
}

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'warning' | 'info' | 'error';
  timestamp: string;
}

export interface ThresholdRule {
  metric: string;
  targetMin?: number;
  targetMax?: number;
  criticalMin?: number;
  criticalMax?: number;
  unit: string;
  description: string;
}
