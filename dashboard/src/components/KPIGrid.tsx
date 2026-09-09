import React, { useState } from 'react';
import { TimeSeriesPoint } from '../types';

interface KPIGridProps {
  utilization: number;
  totalAgents: number;
  connectedAgents: number;
  abandonmentRate: number;
  totalAbandoned: number;
  inFlightCalls: number;
  connectedConversations: number;
  answerRatePct: number;
  avgHandlingTimeSec: number;
  safetyInterventions: number;
  history: TimeSeriesPoint[];
  timeWindow: string;
}

export const KPIGrid: React.FC<KPIGridProps> = ({
  utilization,
  totalAgents,
  connectedAgents,
  abandonmentRate,
  totalAbandoned,
  inFlightCalls,
  connectedConversations,
  answerRatePct,
  avgHandlingTimeSec,
  safetyInterventions,
  history,
  timeWindow,
}) => {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // Utilization Delta
  const prevUtil = history.length > 5 ? history[history.length - 6].utilization : utilization;
  const utilDelta = Number((utilization - prevUtil).toFixed(1));

  // Abandonment Delta
  const prevAbn = history.length > 5 ? history[history.length - 6].abandonmentRate : abandonmentRate;
  const abnDelta = Number((abandonmentRate - prevAbn).toFixed(2));

  // Compliance check
  const isAbnCompliant = abandonmentRate <= 3.0;
  const isUtilOptimal = utilization >= 70.0 && utilization <= 88.0;

  // Mini Sparkline SVG Generator
  const renderSparkline = (dataKey: 'utilization' | 'abandonmentRate' | 'dialed' | 'connected', color: string) => {
    if (!history || history.length < 2) return null;
    const values = history.map((h) => h[dataKey]);
    const min = Math.min(...values);
    const max = Math.max(...values, min + 1);
    const width = 80;
    const height = 26;

    const points = values
      .map((val, idx) => {
        const x = (idx / (values.length - 1)) * width;
        const y = height - ((val - min) / (max - min)) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg width={width} height={height} className="kpi-sparkline" aria-hidden="true">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  return (
    <>
      <div className="kpi-grid">
        {/* 1. Agent Utilization */}
        <div
          className="kpi-card"
          tabIndex={0}
          role="button"
          aria-label="Agent Utilization metric card. Click for formula details."
          onClick={() => setSelectedMetric('utilization')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMetric('utilization'); }}
          style={{ borderLeft: `4px solid ${isUtilOptimal ? '#10b981' : '#6366f1'}` }}
        >
          <div className="kpi-header">
            <span className="kpi-title">Agent Utilization</span>
            <span
              className="kpi-badge"
              style={{
                background: isUtilOptimal ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)',
                color: isUtilOptimal ? '#34d399' : '#a5b4fc',
              }}
            >
              {isUtilOptimal ? 'Optimal' : 'Active'}
            </span>
          </div>

          <div className="kpi-value-row">
            <span className="kpi-main-val">{utilization}%</span>
            <span className="kpi-unit">Target: 75–85%</span>
          </div>

          <div className="kpi-trend-row">
            <span className={`kpi-trend-delta ${utilDelta >= 0 ? 'up' : 'down'}`}>
              <span aria-hidden="true">{utilDelta >= 0 ? '▲' : '▼'}</span>
              <span>{Math.abs(utilDelta)} pp vs prior ({timeWindow})</span>
            </span>
            {renderSparkline('utilization', isUtilOptimal ? '#10b981' : '#818cf8')}
          </div>

          <div className="kpi-footer-note">
            <span>{connectedAgents} of {totalAgents} recovery agents on active borrower calls</span>
          </div>
        </div>

        {/* 2. Rolling Abandonment Rate */}
        <div
          className="kpi-card"
          tabIndex={0}
          role="button"
          aria-label="Rolling Abandonment Rate metric card. Click for regulatory limits."
          onClick={() => setSelectedMetric('abandonment')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMetric('abandonment'); }}
          style={{ borderLeft: `4px solid ${isAbnCompliant ? '#10b981' : '#f43f5e'}` }}
        >
          <div className="kpi-header">
            <span className="kpi-title">Abandonment Rate</span>
            <span
              className="kpi-badge"
              style={{
                background: isAbnCompliant ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
                color: isAbnCompliant ? '#34d399' : '#fda4af',
              }}
            >
              {isAbnCompliant ? 'Compliant (<3.0%)' : 'Violation Risk'}
            </span>
          </div>

          <div className="kpi-value-row">
            <span className="kpi-main-val" style={{ color: isAbnCompliant ? '#34d399' : '#f43f5e' }}>
              {abandonmentRate}%
            </span>
            <span className="kpi-unit">Regulatory Ceiling: 3.0%</span>
          </div>

          <div className="kpi-trend-row">
            <span className={`kpi-trend-delta ${abnDelta <= 0 ? 'up' : 'down'}`}>
              <span aria-hidden="true">{abnDelta <= 0 ? '▼' : '▲'}</span>
              <span>{Math.abs(abnDelta)} pp vs prior ({timeWindow})</span>
            </span>
            {renderSparkline('abandonmentRate', isAbnCompliant ? '#10b981' : '#f43f5e')}
          </div>

          <div className="kpi-footer-note">
            <span>Total drops: <strong>{totalAbandoned}</strong> calls (Hard 0 floor preserved)</span>
          </div>
        </div>

        {/* 3. Active Telephony Pipeline */}
        <div
          className="kpi-card"
          tabIndex={0}
          role="button"
          aria-label="Active Telephony Pipeline. Click for carrier leg details."
          onClick={() => setSelectedMetric('pipeline')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMetric('pipeline'); }}
          style={{ borderLeft: '4px solid #06b6d4' }}
        >
          <div className="kpi-header">
            <span className="kpi-title">Telephony Pipeline</span>
            <span className="kpi-badge" style={{ background: 'rgba(6,182,212,0.15)', color: '#7dd3fc' }}>
              Ringing Leg
            </span>
          </div>

          <div className="kpi-value-row">
            <span className="kpi-main-val">{inFlightCalls}</span>
            <span className="kpi-unit">active carrier legs</span>
          </div>

          <div className="kpi-trend-row">
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              In flight across Carrier A & B
            </span>
            {renderSparkline('dialed', '#06b6d4')}
          </div>

          <div className="kpi-footer-note">
            <span>Dispatched under closed-form binomial safe capacity bound</span>
          </div>
        </div>

        {/* 4. Connected Conversations */}
        <div
          className="kpi-card"
          tabIndex={0}
          role="button"
          aria-label="Connected Conversations. Click for recovery conversion stats."
          onClick={() => setSelectedMetric('conversations')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMetric('conversations'); }}
          style={{ borderLeft: '4px solid #10b981' }}
        >
          <div className="kpi-header">
            <span className="kpi-title">Connected Calls</span>
            <span className="kpi-badge" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
              Recoveries
            </span>
          </div>

          <div className="kpi-value-row">
            <span className="kpi-main-val">{connectedConversations}</span>
            <span className="kpi-unit">live engagements</span>
          </div>

          <div className="kpi-trend-row">
            <span style={{ fontSize: '13px', color: '#34d399', fontWeight: 600 }}>
              Right-party contacts engaged
            </span>
            {renderSparkline('connected', '#10b981')}
          </div>

          <div className="kpi-footer-note">
            <span>Avg Talk Duration: <strong>{avgHandlingTimeSec}s</strong></span>
          </div>
        </div>

        {/* 5. Right-Party Answer Rate (p̂) */}
        <div
          className="kpi-card"
          tabIndex={0}
          role="button"
          onClick={() => setSelectedMetric('answerrate')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMetric('answerrate'); }}
          style={{ borderLeft: '4px solid #a855f7' }}
        >
          <div className="kpi-header">
            <span className="kpi-title">Contact / Answer Rate (p̂)</span>
            <span className="kpi-badge" style={{ background: 'rgba(168,85,247,0.15)', color: '#d8b4fe' }}>
              EWMA
            </span>
          </div>

          <div className="kpi-value-row">
            <span className="kpi-main-val">{answerRatePct}%</span>
            <span className="kpi-unit">adaptive estimate</span>
          </div>

          <div className="kpi-trend-row">
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Horizon: <strong>λ=0.85</strong> exponential smoothing
            </span>
          </div>

          <div className="kpi-footer-note">
            <span>Feeds directly into predictive over-dialing proposal math</span>
          </div>
        </div>

        {/* 6. Safety Interventions & Clamps */}
        <div
          className="kpi-card"
          tabIndex={0}
          role="button"
          onClick={() => setSelectedMetric('safety')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMetric('safety'); }}
          style={{ borderLeft: '4px solid #f59e0b' }}
        >
          <div className="kpi-header">
            <span className="kpi-title">Safety Clamps</span>
            <span className="kpi-badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
              Firewall Active
            </span>
          </div>

          <div className="kpi-value-row">
            <span className="kpi-main-val">{safetyInterventions}</span>
            <span className="kpi-unit">dials clamped</span>
          </div>

          <div className="kpi-trend-row">
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Quadratic bound prevented overdialing
            </span>
          </div>

          <div className="kpi-footer-note">
            <span>100% adherence to 99th percentile binomial inequality</span>
          </div>
        </div>
      </div>

      {/* Metric Detail Modal */}
      {selectedMetric && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedMetric(null)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 className="modal-title">Metric Deep-Dive: {selectedMetric.toUpperCase()}</h3>
              <button
                className="action-btn"
                style={{ background: 'transparent', color: 'var(--text-muted)' }}
                onClick={() => setSelectedMetric(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {selectedMetric === 'utilization' && (
                <div>
                  <p><strong>Agent Utilization Definition:</strong></p>
                  <p style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                    Measures the percentage of logged-in recovery agents who are actively engaged in connected debtor conversations (C / N_agents).
                  </p>
                  <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>
                    <code>Target Range: 75.0% – 85.0%</code><br />
                    <code>Current Value: {utilization}%</code><br />
                    <code>Connected Agents: {connectedAgents} / {totalAgents}</code>
                  </div>
                </div>
              )}

              {selectedMetric === 'abandonment' && (
                <div>
                  <p><strong>Rolling Abandonment Compliance:</strong></p>
                  <p style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                    Regulatory compliance mandates that call abandonment must remain strictly below 3.0% over any 30-day or hourly window. An answered call is abandoned if not connected to an agent within 2.0 seconds.
                  </p>
                  <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>
                    <code>Regulatory Limit: 3.00%</code><br />
                    <code>SmartDialer Aim: &lt; 1.00% (Strict 0 floor)</code><br />
                    <code>AIMD Multiplicative Action: Halve α to 0.5 upon any single abandon</code>
                  </div>
                </div>
              )}

              {selectedMetric !== 'utilization' && selectedMetric !== 'abandonment' && (
                <div>
                  <p><strong>Operational Telemetry Metric:</strong></p>
                  <p style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                    Monitored in real-time by the dialer orchestration engine and recorded into PostgreSQL audit logs for supervisory compliance reporting.
                  </p>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="action-btn btn-primary" onClick={() => setSelectedMetric(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
