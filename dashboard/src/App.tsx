import React, { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { AgentGrid } from './components/AgentGrid';
import { CallFunnel } from './components/CallFunnel';
import { PacingPanel } from './components/PacingPanel';

type TabType = 'agents' | 'funnel' | 'pacing';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('agents');
  const {
    data,
    isConnected,
    isSimRunning,
    scenario,
    mode,
    toggleSim,
    resetSim,
    changeScenario,
    changeMode,
  } = useWebSocket();

  // Compute live executive KPI metrics
  const totalAgents = Object.values(data.agents).reduce((a, b) => a + b, 0) || 50;
  const connectedAgents = data.agents.CONNECTED || 0;
  const utilization = ((connectedAgents / totalAgents) * 100).toFixed(1);

  const totalAnswered = data.funnel.ANSWERED || 0;
  const totalAbandoned = data.funnel.ABANDONED || 0;
  const totalCompleted = data.funnel.COMPLETED || 0;
  const inFlightCalls = (data.funnel.INITIATED || 0) + (data.funnel.RINGING || 0);

  const rollingAbandonmentRate =
    totalAnswered + totalAbandoned > 0
      ? ((totalAbandoned / (totalAnswered + totalAbandoned)) * 100).toFixed(2)
      : '0.00';

  const isCompliant = Number(rollingAbandonmentRate) < 1.0;

  return (
    <div className="dashboard-container">
      {/* Top Header */}
      <header className="header">
        <div>
          <h1 className="brand-title">
            <span style={{ fontSize: '28px' }}>⚡</span>
            CredResolve SmartDialer
          </h1>
          <p className="brand-subtitle">
            Autonomous Recovery Engine with Mathematical Safety Controller & RBI Regulatory Firewall
          </p>
        </div>

        <div className="header-status-group">
          <div className="carrier-pill">
            <span style={{ color: '#34d399' }}>●</span> Carrier A: <strong>CLOSED (Healthy)</strong>
          </div>
          <div className="carrier-pill">
            <span style={{ color: scenario === 'D' ? '#fb7185' : '#34d399' }}>●</span> Carrier B: <strong>{scenario === 'D' ? 'CHAOS' : 'CLOSED'}</strong>
          </div>
          <div className={`status-badge ${isConnected ? '' : 'demo'}`}>
            <span
              className="status-dot"
              style={{
                backgroundColor: isConnected ? '#34d399' : '#818cf8',
                boxShadow: isConnected ? '0 0 10px #34d399' : '0 0 10px #818cf8',
              }}
            />
            {isConnected ? 'LIVE WEBSOCKET STREAM' : 'AUTO-SIMULATOR RUNNING'}
          </div>
        </div>
      </header>

      {/* Control Toolbar */}
      <div className="control-toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Scenarios:</span>
          {(['A', 'B', 'C', 'D'] as const).map((s) => (
            <button
              key={s}
              className={`chip-button ${scenario === s ? 'active' : ''}`}
              onClick={() => changeScenario(s)}
            >
              Scenario {s} {s === 'A' ? '(20% Ans)' : s === 'B' ? '(50% Ans)' : s === 'C' ? '(70% Stress)' : '(Drift Chaos)'}
            </button>
          ))}
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">Pacing Mode:</span>
          {(['PREDICTIVE', 'PROGRESSIVE'] as const).map((m) => (
            <button
              key={m}
              className={`chip-button ${mode === m ? 'active' : ''}`}
              onClick={() => changeMode(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="toolbar-group">
          <button className="action-btn btn-primary" onClick={toggleSim}>
            {isSimRunning ? '⏸ Pause Pacing' : '▶ Resume Pacing'}
          </button>
          <button className="action-btn btn-secondary" onClick={resetSim}>
            🔄 Reset Pool
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="kpi-grid">
        <div className="kpi-card" style={{ borderLeft: '4px solid #6366f1' }}>
          <div className="kpi-title">Agent Utilization</div>
          <div className="kpi-value">
            {utilization}%
            <span style={{ fontSize: '13px', color: '#34d399', fontWeight: 600 }}>Target: 80%</span>
          </div>
          <div className="kpi-sub">{connectedAgents} of {totalAgents} recovery agents on active calls</div>
        </div>

        <div className="kpi-card" style={{ borderLeft: `4px solid ${isCompliant ? '#10b981' : '#f43f5e'}` }}>
          <div className="kpi-title">Rolling Abandonment Rate</div>
          <div className="kpi-value" style={{ color: isCompliant ? '#34d399' : '#fb7185' }}>
            {rollingAbandonmentRate}%
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: isCompliant ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)' }}>
              {isCompliant ? 'COMPLIANT (<1%)' : 'AIMD CLAMP ACTIVE'}
            </span>
          </div>
          <div className="kpi-sub">Total Abandoned: {totalAbandoned} (Strict 0 Abandonment floor)</div>
        </div>

        <div className="kpi-card" style={{ borderLeft: '4px solid #06b6d4' }}>
          <div className="kpi-title">Active Telephony Pipeline</div>
          <div className="kpi-value">
            {inFlightCalls}
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>dials</span>
          </div>
          <div className="kpi-sub">Originated & Ringing in carrier leg</div>
        </div>

        <div className="kpi-card" style={{ borderLeft: '4px solid #10b981' }}>
          <div className="kpi-title">Connected Conversations</div>
          <div className="kpi-value">
            {totalCompleted + connectedAgents}
            <span style={{ fontSize: '13px', color: '#34d399' }}>successful</span>
          </div>
          <div className="kpi-sub">Borrowers reached & engaged</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`tab-button ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          Agent State Grid (Live Workforce)
        </button>
        <button
          className={`tab-button ${activeTab === 'funnel' ? 'active' : ''}`}
          onClick={() => setActiveTab('funnel')}
        >
          Call Funnel (Pipeline Conversion)
        </button>
        <button
          className={`tab-button ${activeTab === 'pacing' ? 'active' : ''}`}
          onClick={() => setActiveTab('pacing')}
        >
          Pacing & Safety Audit Trail (Why N Calls?)
        </button>
      </nav>

      {/* Main Tab Content */}
      <main>
        {activeTab === 'agents' && <AgentGrid agents={data.agents} />}
        {activeTab === 'funnel' && <CallFunnel funnel={data.funnel} />}
        {activeTab === 'pacing' && <PacingPanel decisions={data.decisions} />}
      </main>
    </div>
  );
};
