// Client-side simulation fallback for standalone Vercel preview and offline demos
// Implements the exact same binomial safety bound and AIMD algorithms as the Python backend.

export interface DecisionRow {
  id: string;
  tick_id: number;
  decided_at: string;
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
}

export class ClientDialerEngine {
  public agents: Record<string, number> = {
    AVAILABLE: 50,
    RESERVED: 0,
    DIALING: 0,
    CONNECTED: 0,
    WRAP_UP: 0,
    PAUSED: 0,
    OFFLINE: 0,
  };

  public funnel: Record<string, number> = {
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
  public tickId = 0;
  public alpha = 0.5;
  public p_hat = 0.3;
  public d_hat = 8.0;
  public h_hat = 120.0;
  public sigma_hat = 0.1;
  public mode: 'PREDICTIVE' | 'PROGRESSIVE' = 'PREDICTIVE';
  public scenario: 'A' | 'B' | 'C' | 'D' = 'A';
  public circuitA = 'CLOSED';
  public circuitB = 'CLOSED';

  private agentTimers: Array<{ status: string; remaining: number }> = [];

  constructor() {
    this.reset(50);
  }

  public reset(numAgents = 50) {
    this.agents = {
      AVAILABLE: numAgents,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      WRAP_UP: 0,
      PAUSED: 0,
      OFFLINE: 0,
    };
    this.funnel = {
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
    this.agentTimers = Array(numAgents).fill(null).map(() => ({ status: 'AVAILABLE', remaining: 0 }));
    this.decisions = [];
    this.tickId = 0;
    this.alpha = 0.5;
    this.p_hat = 0.3;
  }

  public tick(): {
    agents: Record<string, number>;
    funnel: Record<string, number>;
    decisions: DecisionRow[];
  } {
    this.tickId += 1;

    // Determine scenario answer rate
    let answerRate = 0.3;
    let talkTime = 90;
    if (this.scenario === 'A') {
      answerRate = 0.2;
      talkTime = 120;
    } else if (this.scenario === 'B') {
      answerRate = 0.5;
      talkTime = 90;
    } else if (this.scenario === 'C') {
      answerRate = 0.7;
      talkTime = 180;
    } else if (this.scenario === 'D') {
      // Drift: 20% -> 70% -> 10%
      const cycle = this.tickId % 180;
      if (cycle < 60) answerRate = 0.2;
      else if (cycle < 120) answerRate = 0.7;
      else {
        answerRate = 0.1;
        this.circuitB = this.tickId % 30 < 10 ? 'OPEN' : 'CLOSED';
      }
    }

    // 1. Progress active agent call timers
    for (const ag of this.agentTimers) {
      if (ag.status === 'CONNECTED') {
        ag.remaining -= 1;
        if (ag.remaining <= 0) {
          ag.status = 'WRAP_UP';
          ag.remaining = 4;
          this.funnel.COMPLETED += 1;
        }
      } else if (ag.status === 'WRAP_UP') {
        ag.remaining -= 1;
        if (ag.remaining <= 0) {
          ag.status = 'AVAILABLE';
        }
      }
    }

    // Recompute current counts
    const A = this.agentTimers.filter((a) => a.status === 'AVAILABLE').length;
    const C = this.agentTimers.filter((a) => a.status === 'CONNECTED').length;
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
      // Predictive proposal: floor(alpha * (A + F) / p_hat)
      n_proposed = Math.max(0, Math.floor((this.alpha * (A + F)) / Math.max(this.p_hat, 0.05)));

      // Closed-form binomial safety inequality:
      // u*(R+n) + z*sqrt((R+n)*u*(1-u)) <= A + F
      const u = Math.max(0.05, Math.min(0.98, this.p_hat + 2.0 * this.sigma_hat));
      const z = 2.33;
      const inner = z * Math.sqrt(u * (1.0 - u));
      const discriminant = inner * inner + 4.0 * u * (A + F);
      const x_max = (-inner + Math.sqrt(Math.max(0.0, discriminant))) / (2.0 * u);
      const n_max = Math.max(0, Math.floor(x_max * x_max - R));

      n_approved = Math.min(n_proposed, n_max);

      if (n_approved < n_proposed) {
        clamp_reasons.push('binomial_safety_bound');
      }
      if (this.circuitB === 'OPEN' && this.scenario === 'D') {
        n_approved = 0;
        clamp_reasons.push('circuit_open');
      }
    }

    // Record decision audit row
    const decision: DecisionRow = {
      id: `dec_${this.tickId}`,
      tick_id: this.tickId,
      decided_at: new Date().toISOString(),
      A,
      R,
      C,
      p_hat: Number(this.p_hat.toFixed(4)),
      d_hat: this.d_hat,
      h_hat: this.h_hat,
      f_available: Number(F.toFixed(2)),
      alpha: Number(this.alpha.toFixed(4)),
      provider_circuit: this.circuitB === 'OPEN' ? 'OPEN' : 'CLOSED',
      n_proposed,
      n_approved,
      clamp_reasons,
      mode_used,
    };
    this.decisions.unshift(decision);
    if (this.decisions.length > 50) this.decisions.pop();

    // Place dials
    if (n_approved > 0) {
      this.funnel.INITIATED += n_approved;
      this.funnel.QUEUED = Math.max(0, this.funnel.QUEUED - n_approved);

      // Simulate answers for approved calls
      for (let i = 0; i < n_approved; i++) {
        const answers = Math.random() < answerRate;
        if (answers) {
          this.funnel.ANSWERED += 1;
          this.p_hat = 0.8 * this.p_hat + 0.2 * 1.0;

          // Atomic attach to free agent
          const freeAgent = this.agentTimers.find((a) => a.status === 'AVAILABLE');
          if (freeAgent) {
            freeAgent.status = 'CONNECTED';
            freeAgent.remaining = Math.max(10, Math.round(talkTime + (Math.random() * 20 - 10)));
            this.funnel.CONNECTED += 1;
          } else {
            // Over-dialed without available agent -> ABANDONMENT
            this.funnel.ABANDONED += 1;
            this.alpha = Math.max(0.2, this.alpha / 2.0); // AIMD Halve
          }
        } else {
          this.funnel.FAILED += 1;
          this.p_hat = 0.8 * this.p_hat + 0.2 * 0.0;
        }
      }
    }

    // Clean interval slow ramp (+0.05 every 20 ticks without abandonment)
    if (this.tickId % 20 === 0) {
      this.alpha = Math.min(1.0, this.alpha + 0.05);
    }

    // Refresh agent status counts
    this.agents.AVAILABLE = this.agentTimers.filter((a) => a.status === 'AVAILABLE').length;
    this.agents.CONNECTED = this.agentTimers.filter((a) => a.status === 'CONNECTED').length;
    this.agents.WRAP_UP = this.agentTimers.filter((a) => a.status === 'WRAP_UP').length;
    this.agents.DIALING = Math.min(n_approved, this.agents.AVAILABLE);

    return {
      agents: { ...this.agents },
      funnel: { ...this.funnel },
      decisions: [...this.decisions],
    };
  }
}
