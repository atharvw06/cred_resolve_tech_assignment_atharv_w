import React, { useState } from 'react';
import { DecisionRow } from '../types';

interface AuditTrailProps {
  decisions: DecisionRow[];
}

export const AuditTrail: React.FC<AuditTrailProps> = ({ decisions }) => {
  const [selectedDecision, setSelectedDecision] = useState<DecisionRow | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  const filtered = decisions.filter((d) => {
    if (filterSeverity !== 'ALL' && d.severity !== filterSeverity) return false;
    if (filterCategory !== 'ALL' && d.category !== filterCategory) return false;
    return true;
  });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="card-title">Pacing & Safety Controller Audit Trail</h2>
          <p className="card-subtitle">
            Immutable decision log recording state transitions, quadratic binomial clamps, and supervisor actions
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Severity:</span>
          {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((sev) => (
            <button
              key={sev}
              className={`chip-button ${filterSeverity === sev ? 'active' : ''}`}
              onClick={() => setFilterSeverity(sev)}
            >
              {sev}
            </button>
          ))}

          <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '8px' }}>Category:</span>
          {(['ALL', 'SAFETY_CONTROLLER', 'OPERATOR_ACTION'] as const).map((cat) => (
            <button
              key={cat}
              className={`chip-button ${filterCategory === cat ? 'active' : ''}`}
              onClick={() => setFilterCategory(cat)}
            >
              {cat === 'SAFETY_CONTROLLER' ? 'Safety Controller' : cat === 'OPERATOR_ACTION' ? 'Operator' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Timestamp (UTC)</th>
              <th>Severity</th>
              <th>Category / Actor</th>
              <th>Agents (A)</th>
              <th>Ringing (R)</th>
              <th>Connected (C)</th>
              <th>Contact Rate (p̂)</th>
              <th>Proposed (n)</th>
              <th>Approved (n*)</th>
              <th>Clamp Reasons / Action</th>
              <th>Math Audit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                  No audit log entries matching current criteria.
                </td>
              </tr>
            ) : (
              filtered.map((d) => {
                const isClamped = d.n_approved < d.n_proposed;
                const isOperator = d.category === 'OPERATOR_ACTION';

                return (
                  <tr
                    key={d.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedDecision(d)}
                  >
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {d.decided_at ? new Date(d.decided_at).toLocaleTimeString() : ''}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
                        #{d.tick_id}
                      </span>
                    </td>

                    <td>
                      <span
                        className="status-pill"
                        style={{
                          background:
                            d.severity === 'CRITICAL'
                              ? 'rgba(244,63,94,0.15)'
                              : d.severity === 'WARNING'
                              ? 'rgba(245,158,11,0.15)'
                              : 'rgba(16,185,129,0.12)',
                          color:
                            d.severity === 'CRITICAL'
                              ? '#fda4af'
                              : d.severity === 'WARNING'
                              ? '#fbbf24'
                              : '#34d399',
                        }}
                      >
                        {d.severity || 'INFO'}
                      </span>
                    </td>

                    <td>
                      <strong style={{ color: isOperator ? '#a78bfa' : 'var(--text-primary)' }}>
                        {d.actor || 'Safety Controller'}
                      </strong>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {d.category || 'SAFETY_CONTROLLER'}
                      </div>
                    </td>

                    <td style={{ color: '#34d399', fontWeight: 700 }}>{d.A}</td>
                    <td style={{ color: '#38bdf8' }}>{d.R}</td>
                    <td style={{ color: '#818cf8' }}>{d.C}</td>
                    <td>{(d.p_hat * 100).toFixed(1)}%</td>

                    <td style={{ fontWeight: 600 }}>{isOperator ? '—' : d.n_proposed}</td>
                    <td
                      style={{
                        fontWeight: 800,
                        color: isOperator ? 'var(--text-muted)' : d.n_approved > 0 ? '#34d399' : '#f43f5e',
                      }}
                    >
                      {isOperator ? '—' : d.n_approved}
                    </td>

                    <td>
                      {isOperator ? (
                        <span style={{ color: '#a78bfa', fontWeight: 600 }}>
                          {d.clamp_reasons[0]}: {d.reason}
                        </span>
                      ) : d.clamp_reasons && d.clamp_reasons.length > 0 ? (
                        d.clamp_reasons.map((r, i) => (
                          <span
                            key={i}
                            style={{
                              display: 'inline-block',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: 'rgba(244,63,94,0.12)',
                              color: '#fda4af',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              marginRight: '4px',
                            }}
                          >
                            {r}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: '#34d399', fontSize: '12px', fontWeight: 600 }}>
                          ✓ Unconstrained
                        </span>
                      )}
                    </td>

                    <td>
                      {!isOperator ? (
                        <button
                          className="action-btn"
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            background: isClamped ? 'rgba(244,63,94,0.15)' : 'rgba(99,102,241,0.15)',
                            color: isClamped ? '#fda4af' : '#a5b4fc',
                            border: `1px solid ${isClamped ? '#f43f5e' : '#6366f1'}`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDecision(d);
                          }}
                        >
                          Inspect Math 🔍
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Manual Audit</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Math Inspection Modal */}
      {selectedDecision && selectedDecision.category !== 'OPERATOR_ACTION' && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedDecision(null)}
        >
          <div
            className="modal-dialog"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className="modal-title">
                Mathematical Proof & Safety Bound — Tick #{selectedDecision.tick_id}
              </h3>
              <button
                className="action-btn"
                style={{ background: 'transparent', color: 'var(--text-muted)' }}
                onClick={() => setSelectedDecision(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ background: '#090d16', padding: '16px', borderRadius: '8px', border: '1px solid #334155', fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', lineHeight: 1.6 }}>
                <p style={{ color: '#38bdf8' }}>// Closed-Form Quadratic Inequality (z=2.33, 99th percentile)</p>
                <p style={{ color: '#f8fafc', marginTop: '6px' }}>
                  u · (R + n) + z · √[(R + n) · u · (1 - u)] ≤ A + F
                </p>
                <div style={{ borderTop: '1px solid #1e293b', margin: '10px 0' }} />
                <p style={{ color: '#94a3b8' }}>Live Parameters Evaluated by Controller:</p>
                <p>• A (Available Agents) = <span style={{ color: '#34d399' }}>{selectedDecision.A}</span></p>
                <p>• R (Active Ringing Calls) = <span style={{ color: '#38bdf8' }}>{selectedDecision.R}</span></p>
                <p>• C (Connected Calls) = <span style={{ color: '#818cf8' }}>{selectedDecision.C}</span></p>
                <p>• F (Pipeline Freed Capacity) = <span style={{ color: '#f8fafc' }}>{selectedDecision.f_available}</span></p>
                <p>• p̂ (Estimated Answer Rate) = <span style={{ color: '#a855f7' }}>{(selectedDecision.p_hat * 100).toFixed(1)}%</span></p>
                <p>• α (AIMD Velocity Scale) = <span style={{ color: '#fbbf24' }}>{selectedDecision.alpha}</span></p>
                <div style={{ borderTop: '1px solid #1e293b', margin: '10px 0' }} />
                <p>Proposed Dials (n): <strong>{selectedDecision.n_proposed}</strong></p>
                <p>Safety Approved Bound (n*): <strong style={{ color: selectedDecision.n_approved > 0 ? '#34d399' : '#f43f5e' }}>{selectedDecision.n_approved}</strong></p>
                <p>Enforced Clamps: <span style={{ color: '#fda4af' }}>{selectedDecision.clamp_reasons.join(', ') || 'None (Clean)'}</span></p>
              </div>

              <p style={{ marginTop: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <strong>Zero Regulatory Violation Guarantee:</strong> By constraining dial proposals to the root of the quadratic inequality, CredResolve guarantees that the probability of debtor answers exceeding available agents remains under 1.0% ($z=2.33$), strictly guarding the 3.0% regulatory ceiling.
              </p>
            </div>

            <div className="modal-actions">
              <button className="action-btn btn-primary" onClick={() => setSelectedDecision(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
