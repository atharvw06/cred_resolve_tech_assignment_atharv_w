import React from 'react';

interface AgentGridProps {
  agents: Record<string, number>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  AVAILABLE: { label: 'AVAILABLE', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
  RESERVED: { label: 'RESERVED', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  DIALING: { label: 'DIALING', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)' },
  CONNECTED: { label: 'CONNECTED', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)' },
  WRAP_UP: { label: 'WRAP_UP', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)' },
  PAUSED: { label: 'PAUSED', color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)' },
  OFFLINE: { label: 'OFFLINE', color: '#64748b', bg: 'rgba(100, 116, 139, 0.12)' },
};

export const AgentGrid: React.FC<AgentGridProps> = ({ agents }) => {
  const total = Object.values(agents).reduce((acc, v) => acc + v, 0);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 className="card-title" style={{ margin: 0 }}>Agent Pool State</h2>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Total Agents: {total}</span>
      </div>
      <div className="agent-grid">
        {Object.entries(STATUS_CONFIG).map(([statusKey, config]) => {
          const count = agents[statusKey] || 0;
          return (
            <div
              key={statusKey}
              className="agent-card"
              style={{ borderLeft: `4px solid ${config.color}`, background: config.bg }}
            >
              <span className="agent-status-label" style={{ color: config.color }}>
                {config.label}
              </span>
              <span className="agent-count" style={{ color: config.color }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
