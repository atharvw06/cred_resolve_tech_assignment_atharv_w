import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { TimeSeriesPoint, FunnelMetrics } from '../types';
import { CarrierStats } from '../sim/clientSim';

interface OperationsOverviewProps {
  history: TimeSeriesPoint[];
  funnel: FunnelMetrics;
  carrierA: CarrierStats;
  carrierB: CarrierStats;
}

export const OperationsOverview: React.FC<OperationsOverviewProps> = ({
  history,
  funnel,
  carrierA,
  carrierB,
}) => {
  const [activeChart, setActiveChart] = useState<'volume' | 'safety' | 'carriers'>('volume');

  const totalInitiated = funnel.INITIATED || 0;
  const totalAnswered = funnel.ANSWERED || 0;
  const totalConnected = funnel.CONNECTED || 0;
  const totalCompleted = funnel.COMPLETED || 0;
  const totalAbandoned = funnel.ABANDONED || 0;

  const answerRate = totalInitiated > 0 ? ((totalAnswered / totalInitiated) * 100).toFixed(1) : '0.0';
  const attachRate = totalAnswered > 0 ? (((totalAnswered - totalAbandoned) / totalAnswered) * 100).toFixed(1) : '100.0';

  return (
    <div className="card">
      {/* Tab Navigation Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <h2 className="card-title">Real-Time Operations & Telemetry Overview</h2>
          <p className="card-subtitle">
            Live volume progression, regulatory abandonment envelope, and telecom carrier route performance
          </p>
        </div>

        <div className="segmented-control" role="tablist" aria-label="Operations chart views">
          <button
            role="tab"
            aria-selected={activeChart === 'volume'}
            className={`segment-btn ${activeChart === 'volume' ? 'active' : ''}`}
            onClick={() => setActiveChart('volume')}
          >
            <span>📈 Call Volume Progression</span>
          </button>
          <button
            role="tab"
            aria-selected={activeChart === 'safety'}
            className={`segment-btn ${activeChart === 'safety' ? 'active' : ''}`}
            onClick={() => setActiveChart('safety')}
          >
            <span>🛡️ Regulatory Safety Envelope</span>
          </button>
          <button
            role="tab"
            aria-selected={activeChart === 'carriers'}
            className={`segment-btn ${activeChart === 'carriers' ? 'active' : ''}`}
            onClick={() => setActiveChart('carriers')}
          >
            <span>📡 Carrier Route Comparison</span>
          </button>
        </div>
      </div>

      {/* View 1: Call Volume Progression */}
      {activeChart === 'volume' && (
        <div>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <AreaChart data={history} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDialed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorConnected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '10px' }} />
                <Area type="monotone" dataKey="dialed" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#colorDialed)" name="Dialed Calls" />
                <Area type="monotone" dataKey="answered" stroke="#818cf8" strokeWidth={2} fillOpacity={0} name="Borrower Answers" />
                <Area type="monotone" dataKey="connected" stroke="#34d399" strokeWidth={2} fillOpacity={1} fill="url(#colorConnected)" name="Connected to Agents" />
                <Line type="monotone" dataKey="abandoned" stroke="#f43f5e" strokeWidth={2} dot={{ r: 4, fill: '#f43f5e' }} name="Abandoned Calls" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '16px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Leads In Queue</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>{funnel.QUEUED}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Dispatched Dials</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>{totalInitiated}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Borrower Answer Rate</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#818cf8' }}>{answerRate}%</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Connected Calls</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#34d399' }}>{totalConnected}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Agent Attach Success</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#34d399' }}>{attachRate}%</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Completed Collections</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#a855f7' }}>{totalCompleted}</div>
            </div>
          </div>
        </div>
      )}

      {/* View 2: Regulatory Safety & Abandonment Envelope */}
      {activeChart === 'safety' && (
        <div>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={history} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <XAxis dataKey="time" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis domain={[0, 4]} stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} unit="%" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                  }}
                  formatter={(val: any) => [`${val}%`, 'Abandonment Rate']}
                />
                <Legend wrapperStyle={{ paddingTop: '10px' }} />
                <ReferenceLine y={3.0} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth={2} label={{ value: '3.0% Regulatory Ceiling', fill: '#f43f5e', position: 'top' }} />
                <ReferenceLine y={1.0} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} label={{ value: '1.0% Warning Floor', fill: '#f59e0b', position: 'top' }} />
                <Line
                  type="monotone"
                  dataKey="abandonmentRate"
                  stroke="#34d399"
                  strokeWidth={3}
                  dot={{ r: 3, fill: '#34d399' }}
                  name="Rolling Abandonment Rate (%)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: '16px', padding: '14px', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <strong style={{ color: '#34d399' }}>✓ Closed-Form Safety Guarantee: </strong>
            The dialer solves the quadratic binomial upper bound on every tick: u * (R + n) + z * sqrt((R + n) * u * (1 - u)) &le; A + F. When the safety margin is threatened, over-dialing proposal n is instantaneously clamped, preventing abandonments before calls are even placed.
          </div>
        </div>
      )}

      {/* View 3: Carrier Route Comparison */}
      {activeChart === 'carriers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
          {/* Carrier A */}
          <div style={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>{carrierA.name}</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Primary Routing Trunk (70% Allocation)</span>
              </div>
              <span className="status-pill status-available">● Healthy</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Circuit State</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#34d399' }}>{carrierA.circuit}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Trunk Latency</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#38bdf8' }}>{carrierA.latencyMs} ms</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Success Rate</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>{carrierA.successRatePct}%</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Dials Dispatched</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>{carrierA.dialsPlaced}</div>
              </div>
            </div>
          </div>

          {/* Carrier B */}
          <div style={{ background: 'var(--bg-surface-elevated)', border: `1px solid ${carrierB.circuit === 'OPEN' ? '#f43f5e' : 'var(--border-default)'}`, borderRadius: '10px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>{carrierB.name}</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Secondary Fallback / Chaos Route</span>
              </div>
              <span className={`status-pill ${carrierB.circuit === 'OPEN' ? 'status-critical' : 'status-available'}`}>
                {carrierB.circuit === 'OPEN' ? '⚠️ Circuit Tripped (OPEN)' : '● Healthy'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Circuit State</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: carrierB.circuit === 'OPEN' ? '#f43f5e' : '#34d399' }}>
                  {carrierB.circuit}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Trunk Latency</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: carrierB.circuit === 'OPEN' ? '#f43f5e' : '#38bdf8' }}>
                  {carrierB.latencyMs} ms
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Success Rate</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: carrierB.circuit === 'OPEN' ? '#f43f5e' : '#10b981' }}>
                  {carrierB.circuit === 'OPEN' ? '12.0%' : `${carrierB.successRatePct}%`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Dials Dispatched</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>{carrierB.dialsPlaced}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
