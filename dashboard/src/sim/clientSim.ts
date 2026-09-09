import { AgentRecord, AgentStatus, DecisionRow, FunnelMetrics, ScenarioKey, PacingMode, TimeSeriesPoint } from '../types';

export type { DecisionRow };

const TEAMS = ['Alpha Recovery', 'Beta Retention', 'Gamma Outbound'] as const;

const FIRST_NAMES = [
  'Aarav', 'Ananya', 'Rohan', 'Pooja', 'Vikram', 'Neha', 'Kabir', 'Tanvi', 'Aditya', 'Rhea',
  'Arjun', 'Isha', 'Dev', 'Kavya', 'Siddharth', 'Meera', 'Dhruv', 'Sanya', 'Varun', 'Anika',
  'Karan', 'Tara', 'Samir', 'Divya', 'Nikhil', 'Pari', 'Rahul', 'Simran', 'Akash', 'Shruti',
  'Manish', 'Shreya', 'Amit', 'Swati', 'Gaurav', 'Payal', 'Harsh', 'Preeti', 'Rajesh', 'Komal',
  'Suresh', 'Bhavna', 'Pranav', 'Nidhi', 'Kunal', 'Jyoti', 'Alok', 'Pallavi', 'Deepak', 'Garima'
];

export interface CarrierStats {
  id: string;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CHAOS' | 'DOWN';
  circuit: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  latencyMs: number;
  successRatePct: number;
  dialsPlaced: number;
  lastFailureTime?: string;
}

export class ClientDialerEngine {
  public agents: AgentRecord[] = [];
  public funnel: FunnelMetrics = {
    QUEUED: 500,
    RESERVED: 0,
    INITIATED: 0,
    RINGING: 0,
    ANSWERED: 0,
    CONNECTED: 0,
    COMPLETED: 0,
    FAILED: 0,
    ABANDONED: 0,
  };

  public decisions: DecisionRow[] = [];
  public history: TimeSeriesPoint[] = [];
  public tickId = 0;
  public alpha = 0.65;
  public p_hat = 0.32;
  public d_hat = 7.5;
  public h_hat = 115.0;
  public sigma_hat = 0.08;
  public mode: PacingMode = 'PREDICTIVE';
  public scenario: ScenarioKey = 'A';

  public carrierA: CarrierStats = {
    id: 'carrier_a',
    name: 'Primary Tier-1 Telco (Carrier A)',
    status: 'HEALTHY',
    circuit: 'CLOSED',
    latencyMs: 142,
    successRatePct: 98.4,
    dialsPlaced: 0,
  };

  public carrierB: CarrierStats = {
    id: 'carrier_b',
    name: 'Secondary Fallback / Chaos Route (Carrier B)',
    status: 'HEALTHY',
    circuit: 'CLOSED',
    latencyMs: 185,
    successRatePct: 95.1,
    dialsPlaced: 0,
  };

  constructor() {
    this.reset(50);
  }

  public reset(numAgents = 50) {
    this.tickId = 0;
    this.alpha = 0.65;
    this.p_hat = 0.32;
    this.funnel = {
      QUEUED: 650,
      RESERVED: 0,
      INITIATED: 0,
      RINGING: 0,
      ANSWERED: 0,
      CONNECTED: 0,
      COMPLETED: 0,
      FAILED: 0,
      ABANDONED: 0,
    };
    this.decisions = [];
    this.history = [];

    this.agents = Array.from({ length: numAgents }, (_, i) => {
      const team = TEAMS[i % TEAMS.length];
      const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${String.fromCharCode(65 + (i % 26))}.`;
      return {
        id: `AG-${String(i + 1).padStart(3, '0')}`,
        name,
        team,
        status: i < 38 ? 'AVAILABLE' : i < 44 ? 'CONNECTED' : i < 48 ? 'WRAP_UP' : 'PAUSED',
        timeInStatusSec: Math.floor(Math.random() * 45) + 5,
        callsHandled: Math.floor(Math.random() * 18) + 4,
        connectedCalls: Math.floor(Math.random() * 8) + 2,
        connectRatePct: Number((Math.random() * 20 + 25).toFixed(1)),
        avgHandlingTimeSec: Math.floor(Math.random() * 30 + 105),
        wrapUpTimeSec: Math.floor(Math.random() * 10 + 12),
        occupancyPct: Number((Math.random() * 15 + 72).toFixed(1)),
        lastActivity: 'Just now',
        hasWarning: false,
      };
    });

    // Seed 15 initial historical time-series points
    const now = Date.now();
    for (let j = 15; j >= 0; j--) {
      const ptTime = new Date(now - j * 4000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.history.push({
        time: ptTime,
        timestamp: now - j * 4000,
        utilization: Number((78 + Math.sin(j) * 6).toFixed(1)),
        abandonmentRate: Number(Math.max(0, 0.4 + Math.cos(j) * 0.3).toFixed(2)),
        offered: Math.round(15 + Math.random() * 8),
        dialed: Math.round(12 + Math.random() * 6),
        answered: Math.round(4 + Math.random() * 3),
        connected: Math.round(4 + Math.random() * 2),
        abandoned: 0,
        completed: Math.round(3 + Math.random() * 2),
      });
    }

    // Initial operator log
    this.recordOperatorAction('System Initialization', 'Auto-simulator engine initialized with 50 agents', 'INFO');
  }

  public recordOperatorAction(
    action: string,
    reason: string,
    severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS' = 'INFO',
    actor = 'Supervisor (Sarah Jenkins)'
  ) {
    const entry: DecisionRow = {
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tick_id: this.tickId,
      decided_at: new Date().toISOString(),
      actor,
      category: 'OPERATOR_ACTION',
      severity,
      A: this.getAvailableCount(),
      R: this.funnel.RINGING + this.funnel.INITIATED,
      C: this.getConnectedCount(),
      p_hat: Number(this.p_hat.toFixed(3)),
      d_hat: this.d_hat,
      h_hat: this.h_hat,
      f_available: 0,
      alpha: Number(this.alpha.toFixed(3)),
      provider_circuit: this.carrierA.circuit,
      n_proposed: 0,
      n_approved: 0,
      clamp_reasons: [action],
      mode_used: this.mode,
      reason,
    };
    this.decisions.unshift(entry);
    if (this.decisions.length > 80) this.decisions.pop();
  }

  public getAvailableCount(): number {
    return this.agents.filter((a) => a.status === 'AVAILABLE').length;
  }

  public getConnectedCount(): number {
    return this.agents.filter((a) => a.status === 'CONNECTED').length;
  }

  public getCountsByStatus(): Record<AgentStatus, number> {
    const counts: Record<AgentStatus, number> = {
      AVAILABLE: 0,
      CONNECTED: 0,
      DIALING: 0,
      WRAP_UP: 0,
      RESERVED: 0,
      PAUSED: 0,
      OFFLINE: 0,
    };
    for (const ag of this.agents) {
      counts[ag.status] = (counts[ag.status] || 0) + 1;
    }
    return counts;
  }

  public tick(): {
    agents: AgentRecord[];
    agentCounts: Record<AgentStatus, number>;
    funnel: FunnelMetrics;
    decisions: DecisionRow[];
    history: TimeSeriesPoint[];
    carrierA: CarrierStats;
    carrierB: CarrierStats;
  } {
    this.tickId += 1;

    // Determine scenario answer rate and characteristics
    let answerRate = 0.28;
    let talkDurationSec = 95;

    if (this.scenario === 'A') {
      answerRate = 0.20;
      talkDurationSec = 110;
      this.carrierB.status = 'HEALTHY';
      this.carrierB.circuit = 'CLOSED';
    } else if (this.scenario === 'B') {
      answerRate = 0.50;
      talkDurationSec = 85;
      this.carrierB.status = 'HEALTHY';
      this.carrierB.circuit = 'CLOSED';
    } else if (this.scenario === 'C') {
      answerRate = 0.70;
      talkDurationSec = 160;
      this.carrierB.status = 'DEGRADED';
      this.carrierB.circuit = 'CLOSED';
    } else if (this.scenario === 'D') {
      // Drift chaos: cyclic transition
      const cycle = this.tickId % 120;
      if (cycle < 40) {
        answerRate = 0.20;
        this.carrierB.status = 'HEALTHY';
        this.carrierB.circuit = 'CLOSED';
      } else if (cycle < 80) {
        answerRate = 0.65;
        this.carrierB.status = 'DEGRADED';
        this.carrierB.circuit = 'HALF_OPEN';
      } else {
        answerRate = 0.12;
        this.carrierB.status = 'CHAOS';
        this.carrierB.circuit = 'OPEN';
        this.carrierB.lastFailureTime = new Date().toLocaleTimeString();
      }
    }

    // 1. Advance agent timers and state machine transitions
    for (const ag of this.agents) {
      ag.timeInStatusSec += 1;

      if (ag.status === 'CONNECTED') {
        if (ag.timeInStatusSec > talkDurationSec) {
          ag.status = 'WRAP_UP';
          ag.timeInStatusSec = 0;
          this.funnel.COMPLETED += 1;
        }
      } else if (ag.status === 'WRAP_UP') {
        if (ag.timeInStatusSec > 8) {
          ag.status = 'AVAILABLE';
          ag.timeInStatusSec = 0;
        }
      } else if (ag.status === 'DIALING') {
        if (ag.timeInStatusSec > 4) {
          ag.status = 'AVAILABLE';
          ag.timeInStatusSec = 0;
        }
      } else if (ag.status === 'AVAILABLE') {
        // Warning if idle without calls for > 200s
        ag.hasWarning = ag.timeInStatusSec > 200;
        if (ag.hasWarning) ag.warningReason = 'Idle without calls > 3m';
      }
    }

    // 2. Recompute available agents A, connected C, ringing R, and future capacity F
    const A = this.getAvailableCount();
    const C = this.getConnectedCount();
    const R = this.funnel.INITIATED + this.funnel.RINGING;
    const F = C * Math.min(1.0, this.d_hat / Math.max(this.h_hat, 1.0));

    let n_proposed = 0;
    let n_approved = 0;
    const clamp_reasons: string[] = [];
    const mode_used = this.mode;

    if (this.mode === 'PROGRESSIVE') {
      n_proposed = A;
      n_approved = A;
    } else {
      // PREDICTIVE MODE:
      // Proposal: floor(alpha * (A + F) / p_hat)
      n_proposed = Math.max(0, Math.floor((this.alpha * (A + F)) / Math.max(this.p_hat, 0.05)));

      // Closed-form quadratic binomial safety bound:
      // u*(R+n) + z*sqrt((R+n)*u*(1-u)) <= A + F
      const u = Math.max(0.05, Math.min(0.98, this.p_hat + 2.0 * this.sigma_hat));
      const z = 2.33; // 99th percentile safety horizon
      const inner = z * Math.sqrt(u * (1.0 - u));
      const discriminant = inner * inner + 4.0 * u * (A + F);
      const x_max = (-inner + Math.sqrt(Math.max(0.0, discriminant))) / (2.0 * u);
      const n_max = Math.max(0, Math.floor(x_max * x_max - R));

      n_approved = Math.min(n_proposed, n_max);

      if (n_approved < n_proposed) {
        clamp_reasons.push('binomial_safety_bound');
      }

      if (this.carrierB.circuit === 'OPEN' && this.scenario === 'D') {
        n_approved = Math.floor(n_approved * 0.4); // Circuit breaker route sheds 60% capacity
        clamp_reasons.push('circuit_breaker_route_shed');
      }
    }

    // 3. Telephony allocation and event outcomes
    let dialsPlaced = 0;
    let newConnects = 0;
    let newAbandons = 0;

    if (n_approved > 0) {
      dialsPlaced = n_approved;
      this.funnel.INITIATED += dialsPlaced;
      this.funnel.QUEUED = Math.max(0, this.funnel.QUEUED - dialsPlaced);
      this.carrierA.dialsPlaced += Math.ceil(dialsPlaced * 0.7);
      this.carrierB.dialsPlaced += Math.floor(dialsPlaced * 0.3);

      for (let i = 0; i < dialsPlaced; i++) {
        const isAnswered = Math.random() < answerRate;
        if (isAnswered) {
          this.funnel.ANSWERED += 1;
          this.p_hat = 0.85 * this.p_hat + 0.15 * 1.0;

          // Find available agent to attach
          const freeAgent = this.agents.find((a) => a.status === 'AVAILABLE');
          if (freeAgent) {
            freeAgent.status = 'CONNECTED';
            freeAgent.timeInStatusSec = 0;
            freeAgent.callsHandled += 1;
            freeAgent.connectedCalls += 1;
            freeAgent.connectRatePct = Number(((freeAgent.connectedCalls / freeAgent.callsHandled) * 100).toFixed(1));
            freeAgent.lastActivity = 'Talking to borrower';
            this.funnel.CONNECTED += 1;
            newConnects += 1;
          } else {
            // Overdialing overshoot -> ABANDONMENT
            this.funnel.ABANDONED += 1;
            newAbandons += 1;
            this.alpha = Math.max(0.2, this.alpha * 0.5); // Multiplicative decrease
            clamp_reasons.push('aimd_halve_on_abandonment');
          }
        } else {
          this.funnel.FAILED += 1;
          this.p_hat = 0.85 * this.p_hat + 0.15 * 0.0;
        }
      }
    }

    // Slow additive ramp (+0.04 every 15 ticks without abandonments)
    if (this.tickId % 15 === 0 && newAbandons === 0) {
      this.alpha = Math.min(1.0, this.alpha + 0.04);
    }

    // 4. Log Decision Audit Entry
    const decisionEntry: DecisionRow = {
      id: `dec_${this.tickId}`,
      tick_id: this.tickId,
      decided_at: new Date().toISOString(),
      actor: 'Safety Controller',
      category: clamp_reasons.length > 0 ? 'SAFETY_CONTROLLER' : 'AIMD_TUNING',
      severity: newAbandons > 0 ? 'CRITICAL' : clamp_reasons.length > 0 ? 'WARNING' : 'INFO',
      A,
      R,
      C,
      p_hat: Number(this.p_hat.toFixed(3)),
      d_hat: this.d_hat,
      h_hat: this.h_hat,
      f_available: Number(F.toFixed(2)),
      alpha: Number(this.alpha.toFixed(3)),
      provider_circuit: this.carrierA.circuit,
      n_proposed,
      n_approved,
      clamp_reasons,
      mode_used,
    };
    this.decisions.unshift(decisionEntry);
    if (this.decisions.length > 80) this.decisions.pop();

    // 5. Append Historical Point
    const totalConnected = this.getConnectedCount();
    const currentUtil = Number(((totalConnected / this.agents.length) * 100).toFixed(1));
    const totalAns = this.funnel.ANSWERED;
    const totalAbn = this.funnel.ABANDONED;
    const currentAbnRate = totalAns + totalAbn > 0 ? Number(((totalAbn / (totalAns + totalAbn)) * 100).toFixed(2)) : 0.0;

    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.history.push({
      time: timeLabel,
      timestamp: Date.now(),
      utilization: currentUtil,
      abandonmentRate: currentAbnRate,
      offered: dialsPlaced + 4,
      dialed: dialsPlaced,
      answered: Math.round(dialsPlaced * answerRate),
      connected: newConnects,
      abandoned: newAbandons,
      completed: 1,
    });
    if (this.history.length > 40) this.history.shift();

    return {
      agents: [...this.agents],
      agentCounts: this.getCountsByStatus(),
      funnel: { ...this.funnel },
      decisions: [...this.decisions],
      history: [...this.history],
      carrierA: { ...this.carrierA },
      carrierB: { ...this.carrierB },
    };
  }
}
