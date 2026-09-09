import React, { useState } from 'react';
import { ScenarioKey, PacingMode } from '../types';

interface PacingControlsProps {
  scenario: ScenarioKey;
  mode: PacingMode;
  isSimRunning: boolean;
  onScenarioChange: (s: ScenarioKey) => void;
  onModeChange: (m: PacingMode) => void;
  onTogglePacing: (reason: string) => void;
  onRequestReset: () => void;
}

const SCENARIO_DESCRIPTIONS: Record<ScenarioKey, { title: string; rate: string; desc: string; badge: string }> = {
  A: {
    title: 'Scenario A: Nominal Collections',
    rate: '20% Answer Rate',
    desc: 'Representative banking collection environment with 120s handle time and nominal carrier stability.',
    badge: 'Nominal Baseline',
  },
  B: {
    title: 'Scenario B: High Connectivity',
    rate: '50% Answer Rate',
    desc: 'Tests dialer pacing convergence when right-party contact rates spike without causing queue abandonment.',
    badge: 'Spike Test',
  },
  C: {
    title: 'Scenario C: Heavy Stress Load',
    rate: '70% Answer Rate',
    desc: 'Aggressive borrower response testing the closed-form quadratic binomial safety clamp firewall.',
    badge: 'Safety Stress',
  },
  D: {
    title: 'Scenario D: Telecom Drift Chaos',
    rate: 'Dynamic Drift & Outage',
    desc: 'Cyclic carrier drift (20% → 65% → 12%) with Carrier B circuit breaker tripping to OPEN state.',
    badge: 'Chaos Recovery',
  },
};

export const PacingControls: React.FC<PacingControlsProps> = ({
  scenario,
  mode,
  isSimRunning,
  onScenarioChange,
  onModeChange,
  onTogglePacing,
  onRequestReset,
}) => {
  const [isToggling, setIsToggling] = useState(false);

  const handleToggle = () => {
    setIsToggling(true);
    onTogglePacing(isSimRunning ? 'Operator paused pacing from control console' : 'Operator resumed pacing');
    setTimeout(() => setIsToggling(false), 400);
  };

  const currentScenario = SCENARIO_DESCRIPTIONS[scenario];

  return (
    <section className="pacing-control-panel" aria-labelledby="controls-panel-title">
      <div className="control-panel-header">
        <div>
          <h2 id="controls-panel-title" className="panel-title">
            <span role="img" aria-label="sliders">🎛️</span>
            Simulation & Pacing Safety Controls
          </h2>
          <p className="panel-subtext">
            Simulated environment: Adjust mathematical pacing model, stress scenarios, and agent allocation bounds in real time
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`action-btn ${isSimRunning ? 'btn-warning' : 'btn-primary'}`}
            onClick={handleToggle}
            disabled={isToggling}
            aria-label={isSimRunning ? 'Pause outbound pacing' : 'Resume outbound pacing'}
          >
            <span>{isSimRunning ? '⏸ Pause Pacing' : '▶ Resume Pacing'}</span>
          </button>

          <button
            className="action-btn btn-danger"
            onClick={onRequestReset}
            title="Reset agent workforce states and dialer queues"
            aria-label="Open confirmation dialog to reset pool"
          >
            <span>🔄 Reset Pool</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginTop: '14px' }}>
        {/* Scenario Segmented Group */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Evaluation Scenario:
            </span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>
              {currentScenario.rate}
            </span>
          </div>

          <div className="segmented-control" style={{ width: '100%', display: 'flex' }} role="radiogroup" aria-label="Select evaluation scenario">
            {(['A', 'B', 'C', 'D'] as ScenarioKey[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={scenario === s}
                style={{ flex: 1, justifyContent: 'center' }}
                className={`segment-btn ${scenario === s ? 'active' : ''}`}
                onClick={() => onScenarioChange(s)}
              >
                <span>Scenario {s}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{currentScenario.title}: </strong>
            {currentScenario.desc}
          </div>
        </div>

        {/* Pacing Mode Segmented Group */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Pacing Engine Mode:
            </span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: mode === 'PREDICTIVE' ? '#a78bfa' : '#34d399' }}>
              {mode === 'PREDICTIVE' ? 'Binomial Bound Protected' : 'Deterministic 1:1'}
            </span>
          </div>

          <div className="segmented-control" style={{ width: '100%', display: 'flex' }} role="radiogroup" aria-label="Select pacing mode">
            {(['PREDICTIVE', 'PROGRESSIVE'] as PacingMode[]).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                style={{ flex: 1, justifyContent: 'center' }}
                className={`segment-btn ${mode === m ? 'active' : ''}`}
                onClick={() => onModeChange(m)}
              >
                <span>{m === 'PREDICTIVE' ? '⚡ Predictive (Alpha AIMD)' : '🛡️ Progressive (1:1)'}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            {mode === 'PREDICTIVE' ? (
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>Predictive Pacing: </strong>
                Over-dials proactively based on historical handle time $h$ and call answer rate $p$, guarded by the quadratic binomial safety firewall.
              </span>
            ) : (
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>Progressive Pacing: </strong>
                Places exactly 1 outbound call per currently available agent. Zero algorithmic overdialing, strictly eliminating abandonment risk.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
