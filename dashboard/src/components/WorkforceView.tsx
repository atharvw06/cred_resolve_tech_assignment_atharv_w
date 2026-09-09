import React, { useState, useMemo } from 'react';
import { AgentRecord, AgentStatus } from '../types';

interface WorkforceViewProps {
  agents: AgentRecord[];
  agentCounts: Record<AgentStatus, number>;
}

const STATUS_DEFINITIONS: Record<
  AgentStatus,
  { label: string; icon: string; color: string; desc: string }
> = {
  AVAILABLE: {
    label: 'Available',
    icon: '🟢',
    color: '#10b981',
    desc: 'Agent is logged in, ready, and idling waiting for next borrower call attach.',
  },
  CONNECTED: {
    label: 'Connected',
    icon: '🟣',
    color: '#6366f1',
    desc: 'Agent is on an active conversation with a debtor regarding recovery.',
  },
  DIALING: {
    label: 'Dialing',
    icon: '🔵',
    color: '#06b6d4',
    desc: 'Reserved agent with pending outbound dial attempting right-party pickup.',
  },
  WRAP_UP: {
    label: 'Wrap-Up',
    icon: '🟪',
    color: '#a855f7',
    desc: 'Call completed; agent entering payment notes or promise-to-pay outcome.',
  },
  RESERVED: {
    label: 'Reserved',
    icon: '🟠',
    color: '#f59e0b',
    desc: 'Agent leased atomically via PostgreSQL SKIP LOCKED before placing dial.',
  },
  PAUSED: {
    label: 'Paused',
    icon: '🟡',
    color: '#eab308',
    desc: 'Agent on break, coaching, or temporary administrative pause.',
  },
  OFFLINE: {
    label: 'Offline',
    icon: '⚪',
    color: '#64748b',
    desc: 'Agent session inactive or logged out from contact center.',
  },
};

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const WorkforceView: React.FC<WorkforceViewProps> = ({ agents, agentCounts }) => {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<keyof AgentRecord>('id');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [density, setDensity] = useState<'normal' | 'compact'>('normal');

  const totalAgents = agents.length || 50;

  // Filtered and Sorted Agent List
  const filteredAgents = useMemo(() => {
    return agents.filter((ag) => {
      if (statusFilter !== 'ALL' && ag.status !== statusFilter) return false;
      if (teamFilter !== 'ALL' && ag.team !== teamFilter) return false;
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        return (
          ag.name.toLowerCase().includes(query) ||
          ag.id.toLowerCase().includes(query) ||
          ag.team.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [agents, statusFilter, teamFilter, searchQuery]);

  const sortedAgents = useMemo(() => {
    return [...filteredAgents].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }, [filteredAgents, sortField, sortAsc]);

  // Pagination
  const totalPages = Math.ceil(sortedAgents.length / pageSize) || 1;
  const paginatedAgents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedAgents.slice(start, start + pageSize);
  }, [sortedAgents, currentPage, pageSize]);

  const handleSort = (field: keyof AgentRecord) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="card">
      {/* Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <h2 className="card-title">Workforce Management & Agent Allocations</h2>
          <p className="card-subtitle">
            PostgreSQL SKIP LOCKED round-robin fairness pool with active occupancy metrics
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View Toggle */}
          <div className="segmented-control" role="group" aria-label="Workforce View Mode">
            <button
              className={`segment-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              aria-label="Switch to Sortable Table View"
            >
              <span>📋 Agent Table</span>
            </button>
            <button
              className={`segment-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Switch to Compact Grid View"
            >
              <span>🔲 Visual Grid</span>
            </button>
          </div>

          {/* Density Control */}
          {viewMode === 'table' && (
            <div className="segmented-control" role="group" aria-label="Table Density">
              <button
                className={`segment-btn ${density === 'normal' ? 'active' : ''}`}
                onClick={() => setDensity('normal')}
              >
                Normal
              </button>
              <button
                className={`segment-btn ${density === 'compact' ? 'active' : ''}`}
                onClick={() => setDensity('compact')}
              >
                Compact
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Proportional Allocation Bar */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#1e293b' }}>
          {(Object.keys(STATUS_DEFINITIONS) as AgentStatus[]).map((st) => {
            const count = agentCounts[st] || 0;
            if (count === 0) return null;
            const pct = (count / totalAgents) * 100;
            return (
              <div
                key={st}
                style={{ width: `${pct}%`, backgroundColor: STATUS_DEFINITIONS[st].color }}
                title={`${STATUS_DEFINITIONS[st].label}: ${count} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* State Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '22px' }}>
        {(Object.keys(STATUS_DEFINITIONS) as AgentStatus[]).map((st) => {
          const cfg = STATUS_DEFINITIONS[st];
          const count = agentCounts[st] || 0;
          const pct = ((count / totalAgents) * 100).toFixed(0);
          const isSelected = statusFilter === st;

          return (
            <div
              key={st}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
              title={cfg.desc}
              onClick={() => setStatusFilter(isSelected ? 'ALL' : st)}
              onKeyDown={(e) => { if (e.key === 'Enter') setStatusFilter(isSelected ? 'ALL' : st); }}
              style={{
                background: isSelected ? 'rgba(255,255,255,0.08)' : 'var(--bg-surface-elevated)',
                border: `1px solid ${isSelected ? cfg.color : 'var(--border-default)'}`,
                borderLeft: `4px solid ${cfg.color}`,
                borderRadius: '8px',
                padding: '10px 12px',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {cfg.icon} {cfg.label}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
                <span style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc' }}>{count}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search by agent name or ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '13px',
              minWidth: '220px',
            }}
          />

          <select
            className="select-control"
            value={teamFilter}
            onChange={(e) => { setTeamFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="All">All Teams</option>
            <option value="Alpha Recovery">Alpha Recovery</option>
            <option value="Beta Retention">Beta Retention</option>
            <option value="Gamma Outbound">Gamma Outbound</option>
          </select>

          {statusFilter !== 'ALL' && (
            <button
              className="action-btn"
              style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(255,255,255,0.06)' }}
              onClick={() => setStatusFilter('ALL')}
            >
              Reset Filter ({statusFilter}) ✕
            </button>
          )}
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Showing <strong>{sortedAgents.length}</strong> of {totalAgents} agents
        </div>
      </div>

      {/* VIEW A: SORTABLE AGENT TABLE */}
      {viewMode === 'table' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('id')} style={{ cursor: 'pointer' }}>
                  Agent ID {sortField === 'id' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                  Agent Name {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('team')} style={{ cursor: 'pointer' }}>
                  Team {sortField === 'team' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                  Status {sortField === 'status' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('timeInStatusSec')} style={{ cursor: 'pointer' }}>
                  Time in State {sortField === 'timeInStatusSec' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('callsHandled')} style={{ cursor: 'pointer' }}>
                  Dials Handled {sortField === 'callsHandled' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('connectedCalls')} style={{ cursor: 'pointer' }}>
                  Connects {sortField === 'connectedCalls' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('connectRatePct')} style={{ cursor: 'pointer' }}>
                  Connect Rate {sortField === 'connectRatePct' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('occupancyPct')} style={{ cursor: 'pointer' }}>
                  Occupancy {sortField === 'occupancyPct' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th>Status Flags</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAgents.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    No agents found matching search criteria.
                  </td>
                </tr>
              ) : (
                paginatedAgents.map((ag) => {
                  const cfg = STATUS_DEFINITIONS[ag.status];
                  const pad = density === 'compact' ? '6px 12px' : '12px 14px';

                  return (
                    <tr key={ag.id}>
                      <td style={{ padding: pad, fontWeight: 700, color: '#f8fafc' }}>{ag.id}</td>
                      <td style={{ padding: pad, fontWeight: 600 }}>{ag.name}</td>
                      <td style={{ padding: pad, color: 'var(--text-muted)' }}>{ag.team}</td>
                      <td style={{ padding: pad }}>
                        <span
                          className="status-pill"
                          style={{
                            background: `${cfg.color}15`,
                            color: cfg.color,
                            borderColor: `${cfg.color}40`,
                          }}
                        >
                          <span aria-hidden="true">{cfg.icon}</span>
                          <span>{cfg.label}</span>
                        </span>
                      </td>
                      <td style={{ padding: pad, fontVariantNumeric: 'tabular-nums' }}>
                        {formatSeconds(ag.timeInStatusSec)}
                      </td>
                      <td style={{ padding: pad }}>{ag.callsHandled}</td>
                      <td style={{ padding: pad, color: '#34d399', fontWeight: 600 }}>{ag.connectedCalls}</td>
                      <td style={{ padding: pad }}>{ag.connectRatePct}%</td>
                      <td style={{ padding: pad, fontWeight: 600 }}>{ag.occupancyPct}%</td>
                      <td style={{ padding: pad }}>
                        {ag.hasWarning ? (
                          <span
                            style={{
                              fontSize: '11px',
                              color: '#fda4af',
                              background: 'rgba(244,63,94,0.15)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                            title={ag.warningReason}
                          >
                            ⚠️ {ag.warningReason}
                          </span>
                        ) : (
                          <span style={{ color: '#34d399', fontSize: '12px' }}>Normal</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#111827', borderTop: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="select-control"
                style={{ padding: '2px 8px' }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                className="action-btn"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '0 8px' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="action-btn"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW B: COMPACT VISUAL GRID */}
      {viewMode === 'grid' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px' }}>
            {sortedAgents.map((ag) => {
              const cfg = STATUS_DEFINITIONS[ag.status];
              return (
                <div
                  key={ag.id}
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-default)',
                    borderLeft: `3px solid ${cfg.color}`,
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '12px',
                  }}
                  title={`${ag.name} (${ag.id}) - ${cfg.label} for ${formatSeconds(ag.timeInStatusSec)}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ color: '#f8fafc' }}>{ag.id}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {formatSeconds(ag.timeInStatusSec)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ag.name}
                  </div>
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px', color: cfg.color, fontWeight: 700, fontSize: '11px' }}>
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
