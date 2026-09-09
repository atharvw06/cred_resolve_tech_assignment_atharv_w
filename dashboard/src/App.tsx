import React, { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { AgentGrid } from './components/AgentGrid';
import { CallFunnel } from './components/CallFunnel';
import { PacingPanel } from './components/PacingPanel';

type TabType = 'agents' | 'funnel' | 'pacing';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('agents');
  const { data, isConnected } = useWebSocket();

  return (
    <div className="dashboard-container">
      <header className="header">
        <div>
          <h1 className="brand-title">CredResolve SmartDialer</h1>
          <p className="brand-subtitle">
            Progressive & Predictive Outbound Collections Engine with Safety Controller Firewall
          </p>
        </div>
        <div className="status-badge">
          <span
            className="status-dot"
            style={{
              backgroundColor: isConnected ? '#34d399' : '#f43f5e',
              boxShadow: isConnected ? '0 0 10px #34d399' : '0 0 10px #f43f5e',
            }}
          />
          {isConnected ? 'LIVE WEBSOCKET CONNECTED' : 'DISCONNECTED / RETRYING'}
        </div>
      </header>

      <nav className="nav-tabs">
        <button
          className={`tab-button ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          Agent State Grid
        </button>
        <button
          className={`tab-button ${activeTab === 'funnel' ? 'active' : ''}`}
          onClick={() => setActiveTab('funnel')}
        >
          Call Funnel
        </button>
        <button
          className={`tab-button ${activeTab === 'pacing' ? 'active' : ''}`}
          onClick={() => setActiveTab('pacing')}
        >
          Pacing & Safety Panel
        </button>
      </nav>

      <main>
        {activeTab === 'agents' && <AgentGrid agents={data.agents} />}
        {activeTab === 'funnel' && <CallFunnel funnel={data.funnel} />}
        {activeTab === 'pacing' && <PacingPanel decisions={data.decisions} />}
      </main>
    </div>
  );
};
