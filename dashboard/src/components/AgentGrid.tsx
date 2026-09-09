import React, { useState } from 'react';

interface AgentGridProps {
  agents: Record<string, number>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  AVAILABLE: { label: 'AVAILABLE', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
  CONNECTED: { label: 'CONNECTED', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)' },
  DIALING: { label: 'DIALING', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)' },
  WRAP_UP: { label: 'WRAP_UP', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)' },
  RESERVED: { label: 'RESERVED', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  PAUSED: { label: 'PAUSED', color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)' },
  OFFLINE: { label: 'OFFLINE', color: '#64748b', bg: 'rgba(100, 116, 139, 0.12)' },
};

export const AgentGrid: React.FC<AgentGridProps> = ({ agents }) => {
  const [filter, setFilter] = useState<string>('ALL');
  const total = Object.values(agents).reduce((acc, v) => acc + v, 0) || 50;

  // Synthesize individual representative agent slots for visual representation
  const agentSlots: Array<{ id: number; name: string; status: string; color: string }> = [];
  let idCounter = 1;
  for (const [statusKey, config] of Object.entries(STATUS_CONFIG)) {
    const count = agents[statusKey] || 0;
    for (let i = 0; i < count; i++) {
      agentSlots.push({
        id: idCounter,
        name: `Agent-${String(idCounter).padStart(2, '0')}`,
        status: statusKey,
        color: config.color,
      });
      idCounter++;
    }
  }

  const filteredSlots = filter === 'ALL' ? agentSlots : agentSlots.filter((a) => a.status === filter);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>Active Collections Agent Workforce</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Round-robin fairness selection with atomic SKIP LOCKED leasing
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            className={`chip-button ${filter === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilter('ALL')}
          >
            All ({total})
          </button>
          {Object.entries(STATUS_CONFIG).map(([st, cfg]) => {
            const count = agents[st] || 0;
            if (count === 0 && st !== 'AVAILABLE' && st !== 'CONNECTED') return null;
            return (
              <button
                key={st}
                className={`chip-button ${filter === st ? 'active' : ''}`}
                onClick={() => setFilter(st)}
              >
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Proportional Workforce Allocation Bar */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#1e293b' }}>
          {Object.entries(STATUS_CONFIG).map(([st, cfg]) => {
            const count = agents[st] || 0;
            if (count === 0) return null;
            const pct = (count / total) * 100;
            return (
              <div
                key={st}
                style={{ width: `${pct}%`, backgroundColor: cfg.color }}
                title={`${st}: ${count} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="agent-grid" style={{ marginBottom: '24px' }}>
        {Object.entries(STATUS_CONFIG).map(([statusKey, config]) => {
          const count = agents[statusKey] || 0;
          return (
            <div
              key={statusKey}
              className="agent-card"
              style={{
                borderLeft: `4px solid ${config.color}`,
                background: config.bg,
                cursor: 'pointer',
              }}
              onClick={() => setFilter(statusKey)}
            >
              <span className="agent-status-label" style={{ color: config.color }}>
                {config.label}
              </span>
              <span className="agent-count" style={{ color: config.color }}>
                {count}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {((count / total) * 100).toFixed(0)}% of pool
              </span>
            </div>
          );
        })}
      </div>

      {/* Representative Agent Roster Matrix */}
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '18px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px' }}>
          Active Agent Allocation Roster ({filteredSlots.length} Displayed)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
          {filteredSlots.map((ag) => (
            <div
              key={ag.id}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '8px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px',
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ag.name}</span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: ag.color,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.05)',
                }}
              >
                {ag.status.substring(0, 4)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
