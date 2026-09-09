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
  { key: 'QUEUED', label: 'Queued Debtor Pool', color: '#94a3b8' },
  { key: 'INITIATED', label: 'Carrier Originated', color: '#38bdf8' },
  { key: 'RINGING', label: 'Borrower Ringing', color: '#06b6d4' },
  { key: 'ANSWERED', label: 'Borrower Answered', color: '#10b981' },
  { key: 'CONNECTED', label: 'Agent Connected', color: '#6366f1' },
  { key: 'COMPLETED', label: 'Terminated / Wrap', color: '#22c55e' },
  { key: 'FAILED', label: 'Carrier / Busy Fail', color: '#ef4444' },
  { key: 'ABANDONED', label: 'Regulatory Abandoned', color: '#f43f5e' },
];

export const CallFunnel: React.FC<CallFunnelProps> = ({ funnel }) => {
  const chartData = STAGES.map((s) => ({
    stage: s.key,
    label: s.label,
    count: funnel[s.key] || 0,
    color: s.color,
  }));

  const totalInitiated = funnel.INITIATED || 0;
  const totalAnswered = funnel.ANSWERED || 0;
  const totalConnected = funnel.CONNECTED || 0;
  const totalAbandoned = funnel.ABANDONED || 0;

  const answerRate = totalInitiated > 0 ? ((totalAnswered / totalInitiated) * 100).toFixed(1) : '0.0';
  const attachSuccessRate = totalAnswered > 0 ? (((totalAnswered - totalAbandoned) / totalAnswered) * 100).toFixed(1) : '100.0';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>Call Lifecycle Conversion Funnel</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Tracks borrower call leg transitions from borrower queue to completed recovery conversation
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Answer Rate</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>{answerRate}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Connected</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#818cf8' }}>{totalConnected}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Attach Success</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#34d399' }}>{attachSuccessRate}%</div>
          </div>
        </div>
      </div>

      <div style={{ width: '100%', height: 380, marginTop: '10px' }}>
        <ResponsiveContainer>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
          >
            <XAxis type="number" stroke="#64748b" />
            <YAxis
              type="category"
              dataKey="stage"
              stroke="#94a3b8"
              width={100}
              tick={{ fontSize: 12, fontWeight: 700 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderColor: 'rgba(255,255,255,0.12)',
                borderRadius: '10px',
                color: '#f8fafc',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
              }}
              formatter={(val: any, _name: any, item: any) => [
                `${val} calls`,
                item.payload.label,
              ]}
            />
            <Bar dataKey="count" radius={[0, 8, 8, 0]}>
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
