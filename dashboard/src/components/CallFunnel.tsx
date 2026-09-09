import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface CallFunnelProps {
  funnel: Record<string, number>;
}

const STAGES = [
  { key: 'QUEUED', color: '#94a3b8' },
  { key: 'RESERVED', color: '#f59e0b' },
  { key: 'INITIATED', color: '#38bdf8' },
  { key: 'RINGING', color: '#06b6d4' },
  { key: 'ANSWERED', color: '#10b981' },
  { key: 'CONNECTED', color: '#6366f1' },
  { key: 'COMPLETED', color: '#22c55e' },
  { key: 'FAILED', color: '#ef4444' },
  { key: 'ABANDONED', color: '#f43f5e' },
];

export const CallFunnel: React.FC<CallFunnelProps> = ({ funnel }) => {
  const chartData = STAGES.map((s) => ({
    stage: s.key,
    count: funnel[s.key] || 0,
    color: s.color,
  }));

  const totalCalls = Object.values(funnel).reduce((acc, v) => acc + v, 0);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="card-title" style={{ margin: 0 }}>Call Lifecycle Funnel</h2>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Total Pipeline Calls: {totalCalls}</span>
      </div>
      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 40, bottom: 5 }}
          >
            <XAxis type="number" stroke="#64748b" />
            <YAxis
              type="category"
              dataKey="stage"
              stroke="#94a3b8"
              width={90}
              tick={{ fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                borderColor: 'rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#f8fafc',
              }}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
