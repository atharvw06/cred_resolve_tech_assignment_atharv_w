import React from 'react';
import { DashboardData } from '../hooks/useWebSocket';

interface PacingPanelProps {
  decisions: DashboardData['decisions'];
}

export const PacingPanel: React.FC<PacingPanelProps> = ({ decisions }) => {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>Pacing Engine & Safety Audit Trail</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Answers "Why N calls?": Full parameter snapshot and Safety Controller clamp reasons.
          </p>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--accent-cyan)', fontWeight: 600 }}>
          {decisions.length} Decisions Logged
        </span>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Tick / Time</th>
              <th>A (Avail)</th>
              <th>R (Ringing)</th>
              <th>C (Connected)</th>
              <th>p̂ (Answer Rate)</th>
              <th>Proposed</th>
              <th>Approved</th>
              <th>Mode</th>
              <th>Safety Clamp Reasons</th>
            </tr>
          </thead>
          <tbody>
            {decisions.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                  No pacing decisions recorded yet. Start simulation or dialer worker to view audit trail.
                </td>
              </tr>
            ) : (
              decisions.map((d) => (
                <tr key={d.id || d.tick_id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    #{d.tick_id}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {d.decided_at ? new Date(d.decided_at).toLocaleTimeString() : ''}
                    </div>
                  </td>
                  <td style={{ color: '#34d399', fontWeight: 600 }}>{d.A}</td>
                  <td style={{ color: '#38bdf8' }}>{d.R}</td>
                  <td style={{ color: '#818cf8' }}>{d.C}</td>
                  <td>{(d.p_hat * 100).toFixed(1)}%</td>
                  <td style={{ fontWeight: 600 }}>{d.n_proposed}</td>
                  <td style={{ fontWeight: 700, color: d.n_approved > 0 ? '#34d399' : '#f43f5e' }}>
                    {d.n_approved}
                  </td>
                  <td>
                    <span className="badge badge-mode">{d.mode_used}</span>
                  </td>
                  <td>
                    {d.clamp_reasons && d.clamp_reasons.length > 0 ? (
                      d.clamp_reasons.map((r, i) => (
                        <span key={i} className="badge badge-reason">
                          {r}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>None (Clean)</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
