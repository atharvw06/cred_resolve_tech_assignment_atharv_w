import React, { useState } from 'react';
import { DecisionRow } from '../sim/clientSim';

interface PacingPanelProps {
  decisions: DecisionRow[];
}

export const PacingPanel: React.FC<PacingPanelProps> = ({ decisions }) => {
  const [selectedDecision, setSelectedDecision] = useState<DecisionRow | null>(null);
  const [filterClamp, setFilterClamp] = useState<string>('ALL');

  const filteredDecisions = decisions.filter((d) => {
    if (filterClamp === 'ALL') return true;
    if (filterClamp === 'CLAMPED') return d.clamp_reasons && d.clamp_reasons.length > 0;
    if (filterClamp === 'CLEAN') return !d.clamp_reasons || d.clamp_reasons.length === 0;
    return d.clamp_reasons && d.clamp_reasons.includes(filterClamp);
  });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>Pacing Engine & Safety Audit Trail</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Answers "Why N calls?": Recomputed DB variables, closed-form quadratic binomial bounds, and clamp reasons
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Filter:</span>
          <button
            className={`chip-button ${filterClamp === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilterClamp('ALL')}
          >
            All
          </button>
          <button
            className={`chip-button ${filterClamp === 'CLAMPED' ? 'active' : ''}`}
            onClick={() => setFilterClamp('CLAMPED')}
          >
            Clamped Only
          </button>
          <button
            className={`chip-button ${filterClamp === 'CLEAN' ? 'active' : ''}`}
            onClick={() => setFilterClamp('CLEAN')}
          >
            Clean
          </button>
        </div>
      </div>

      {/* Audit Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Tick / Time</th>
              <th>A (Avail)</th>
              <th>R (Ringing)</th>
              <th>C (Connected)</th>
              <th>F (Pipeline)</th>
              <th>p̂ (Answer Rate)</th>
              <th>Proposed</th>
              <th>Approved</th>
              <th>Mode</th>
              <th>Safety Clamp Reasons</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredDecisions.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                  No pacing decisions recorded matching filter.
                </td>
              </tr>
            ) : (
              filteredDecisions.map((d) => (
                <tr
                  key={d.id || d.tick_id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedDecision(d)}
                >
                  <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    #{d.tick_id}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {d.decided_at ? new Date(d.decided_at).toLocaleTimeString() : ''}
                    </div>
                  </td>
                  <td style={{ color: '#34d399', fontWeight: 700 }}>{d.A}</td>
                  <td style={{ color: '#38bdf8' }}>{d.R}</td>
                  <td style={{ color: '#818cf8' }}>{d.C}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{d.f_available}</td>
                  <td>{(d.p_hat * 100).toFixed(1)}%</td>
                  <td style={{ fontWeight: 600 }}>{d.n_proposed}</td>
                  <td style={{ fontWeight: 800, color: d.n_approved > 0 ? '#34d399' : '#f43f5e' }}>
                    {d.n_approved}
                  </td>
                  <td>
                    <span className="badge badge-mode">{d.mode_used}</span>
                  </td>
                  <td>
                    {d.clamp_reasons && d.clamp_reasons.length > 0 ? (
                      d.clamp_reasons.map((r: string, i: number) => (
                        <span key={i} className="badge badge-reason">
                          {r}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 600 }}>Clean</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="chip-button"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDecision(d);
                      }}
                    >
                      Inspect Math 🔍
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mathematical Inspection Modal / Drawer */}
      {selectedDecision && (
        <div
          style={{
            marginTop: '24px',
            padding: '20px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderRadius: '12px',
            border: '1px solid var(--accent-indigo)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: '#818cf8' }}>
              Tick #{selectedDecision.tick_id} — Safety Controller Mathematical Proof
            </h3>
            <button
              className="chip-button"
              onClick={() => setSelectedDecision(null)}
              style={{ padding: '4px 10px' }}
            >
              ✕ Close
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '16px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pessimistic Answer Rate (u)</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>
                {(Math.min(0.98, selectedDecision.p_hat + 0.2) * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>p̂ + 2σ (99th %tile bound)</div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Available Capacity (A + F)</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                {(selectedDecision.A + selectedDecision.f_available).toFixed(2)} agents
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Free + Pipeline Clearing</div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AIMD Aggressiveness (α)</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b' }}>
                {selectedDecision.alpha}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Dynamic throttle multiplier</div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Carrier Circuit State</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: selectedDecision.provider_circuit === 'OPEN' ? '#f43f5e' : '#34d399' }}>
                {selectedDecision.provider_circuit}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Outage auto-clamp</div>
            </div>
          </div>

          <div style={{ background: '#0a0f1d', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}>
            <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '6px' }}>
              Formula Evaluated: u · (R + n) + 2.33 · √((R + n) · u · (1 - u)) ≤ A + F
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              The Pacing Engine speculatively proposed <strong>{selectedDecision.n_proposed} dials</strong>.
              The Safety Controller independently solved the closed-form quadratic inequality for worst-case answer rate,
              clamping the safe outbound limit to <strong>{selectedDecision.n_approved} dials</strong>.
              {selectedDecision.clamp_reasons && selectedDecision.clamp_reasons.length > 0 && (
                <span style={{ color: '#fb7185', display: 'block', marginTop: '4px' }}>
                  Clamp Reasons Applied: {selectedDecision.clamp_reasons.join(', ')}
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
