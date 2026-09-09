import React from 'react';
import { GlobalFilters, TimeRange } from '../types';
import { CarrierStats } from '../sim/clientSim';

interface AppHeaderProps {
  connectionStatus: 'LIVE' | 'RECONNECTING' | 'SIMULATOR';
  lastUpdated: Date;
  carrierA: CarrierStats;
  carrierB: CarrierStats;
  filters: GlobalFilters;
  onFilterChange: (newFilters: Partial<GlobalFilters>) => void;
  incidentCount: number;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  connectionStatus,
  lastUpdated,
  carrierA,
  carrierB,
  filters,
  onFilterChange,
  incidentCount,
}) => {
  const isCarrierBChaos = carrierB.status === 'CHAOS' || carrierB.circuit === 'OPEN';

  return (
    <header className="app-header">
      {/* Top Row: Brand, Connection, Carrier Health, Operator */}
      <div className="header-top-row">
        <div className="brand-section">
          <h1 className="brand-title">
            <span role="img" aria-label="lightning">⚡</span>
            <span>CredResolve <span className="brand-title-accent">SmartDialer</span></span>
          </h1>
          <span
            className={`env-badge ${connectionStatus === 'LIVE' ? 'live' : 'simulator'}`}
            title={connectionStatus === 'LIVE' ? 'Connected to local FastAPI backend via WebSocket' : 'Running in-browser deterministic simulation engine'}
          >
            {connectionStatus === 'LIVE' ? '● Live Daemon' : '⚙️ Simulator (Vercel Preview)'}
          </span>
        </div>

        <div className="header-status-cluster">
          {/* Carrier A Health Chip */}
          <div
            className="carrier-chip"
            title={`${carrierA.name} | Circuit: ${carrierA.circuit} | Latency: ${carrierA.latencyMs}ms | Success: ${carrierA.successRatePct}%`}
          >
            <span style={{ color: '#34d399' }} aria-hidden="true">●</span>
            <span>Carrier A:</span>
            <strong style={{ color: '#34d399' }}>Healthy ({carrierA.latencyMs}ms)</strong>
          </div>

          {/* Carrier B Health Chip */}
          <div
            className={`carrier-chip ${isCarrierBChaos ? 'chaos' : ''}`}
            title={`${carrierB.name} | Circuit: ${carrierB.circuit} | Latency: ${carrierB.latencyMs}ms | Success: ${carrierB.successRatePct}%`}
          >
            <span style={{ color: isCarrierBChaos ? '#f43f5e' : '#34d399' }} aria-hidden="true">
              {isCarrierBChaos ? '⚠️' : '●'}
            </span>
            <span>Carrier B:</span>
            <strong style={{ color: isCarrierBChaos ? '#fda4af' : '#34d399' }}>
              {isCarrierBChaos ? `Chaos (${carrierB.circuit})` : 'Healthy'}
            </strong>
          </div>

          {/* Incidents Indicator */}
          {incidentCount > 0 && (
            <div
              className="carrier-chip chaos"
              title={`${incidentCount} safety controller clamp interventions recorded in recent interval`}
            >
              <span>🚨</span>
              <span>{incidentCount} Interventions</span>
            </div>
          )}

          {/* Operator Profile */}
          <div
            className="carrier-chip"
            style={{ borderLeft: '3px solid #6366f1' }}
            title="Authenticated contact center operations supervisor"
          >
            <span>👤</span>
            <span>Supervisor: <strong>Sarah J.</strong></span>
          </div>

          {/* Freshness Clock */}
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Updated: <strong style={{ color: 'var(--text-secondary)' }}>{lastUpdated.toLocaleTimeString()}</strong>
          </div>
        </div>
      </div>

      {/* Bottom Row: Global Operations Filters */}
      <div className="header-filter-bar">
        <div className="filter-group">
          <span className="filter-label">Time Window:</span>
          <div className="segmented-control" role="group" aria-label="Time Window Selector">
            {(['5m', '15m', '30m', '1h', 'today'] as TimeRange[]).map((t) => (
              <button
                key={t}
                className={`segment-btn ${filters.timeRange === t ? 'active' : ''}`}
                onClick={() => onFilterChange({ timeRange: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label htmlFor="campaign-filter" className="filter-label">Campaign:</label>
          <select
            id="campaign-filter"
            className="select-control"
            value={filters.campaign}
            onChange={(e) => onFilterChange({ campaign: e.target.value })}
          >
            <option value="All">All Campaigns</option>
            <option value="Auto Loans">Auto Loans (Delinquent 30+)</option>
            <option value="Credit Cards">Credit Cards (Recovery 60+)</option>
            <option value="Personal Loans">Personal Loans (Pre-chargeoff)</option>
          </select>

          <label htmlFor="queue-filter" className="filter-label">Queue:</label>
          <select
            id="queue-filter"
            className="select-control"
            value={filters.queue}
            onChange={(e) => onFilterChange({ queue: e.target.value })}
          >
            <option value="All">All Queues</option>
            <option value="Priority">Priority Inbound Attach</option>
            <option value="Standard">Standard Outbound Dialer</option>
            <option value="High Balance">High Balance Delinquency</option>
          </select>

          <label htmlFor="team-filter" className="filter-label">Team:</label>
          <select
            id="team-filter"
            className="select-control"
            value={filters.team}
            onChange={(e) => onFilterChange({ team: e.target.value })}
          >
            <option value="All">All Teams</option>
            <option value="Alpha Recovery">Alpha Recovery</option>
            <option value="Beta Retention">Beta Retention</option>
            <option value="Gamma Outbound">Gamma Outbound</option>
          </select>
        </div>
      </div>
    </header>
  );
};
