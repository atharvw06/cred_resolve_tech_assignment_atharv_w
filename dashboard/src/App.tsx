import React, { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { AppHeader } from './components/AppHeader';
import { PacingControls } from './components/PacingControls';
import { KPIGrid } from './components/KPIGrid';
import { OperationsOverview } from './components/OperationsOverview';
import { WorkforceView } from './components/WorkforceView';
import { AuditTrail } from './components/AuditTrail';
import { ConfirmModal } from './components/ConfirmModal';
import { ToastContainer } from './components/ToastContainer';

export const App: React.FC = () => {
  const {
    data,
    connectionStatus,
    isSimRunning,
    scenario,
    mode,
    lastUpdated,
    toasts,
    filters,
    setFilters,
    removeToast,
    toggleSim,
    resetSim,
    changeScenario,
    changeMode,
  } = useWebSocket();

  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<'overview' | 'workforce' | 'audit'>('overview');

  // Compute live executive KPI metrics
  const totalAgents = data.agents.length || 50;
  const connectedAgents = data.agents.filter((a) => a.status === 'CONNECTED').length;
  const utilization = Number(((connectedAgents / totalAgents) * 100).toFixed(1));

  const totalAnswered = data.funnel.ANSWERED || 0;
  const totalAbandoned = data.funnel.ABANDONED || 0;
  const inFlightCalls = (data.funnel.INITIATED || 0) + (data.funnel.RINGING || 0);
  const connectedConversations = (data.funnel.COMPLETED || 0) + connectedAgents;

  const rollingAbandonmentRate =
    totalAnswered + totalAbandoned > 0
      ? Number(((totalAbandoned / (totalAnswered + totalAbandoned)) * 100).toFixed(2))
      : 0.0;

  const answerRatePct = Number(((totalAnswered / Math.max(1, data.funnel.INITIATED || 1)) * 100).toFixed(1));

  // Count recent interventions
  const safetyInterventions = data.decisions.filter(
    (d) => d.clamp_reasons && d.clamp_reasons.length > 0 && d.category !== 'OPERATOR_ACTION'
  ).length;

  return (
    <div className="dashboard-container">
      {/* 1. Header & Global Operations Filter Bar */}
      <AppHeader
        connectionStatus={connectionStatus}
        lastUpdated={lastUpdated}
        carrierA={data.carrierA}
        carrierB={data.carrierB}
        filters={filters}
        onFilterChange={(newF) => setFilters((prev) => ({ ...prev, ...newF }))}
        incidentCount={safetyInterventions}
      />

      {/* 2. Simulation & Pacing Control Console */}
      <PacingControls
        scenario={scenario}
        mode={mode}
        isSimRunning={isSimRunning}
        onScenarioChange={changeScenario}
        onModeChange={changeMode}
        onTogglePacing={toggleSim}
        onRequestReset={() => setIsResetModalOpen(true)}
      />

      {/* 3. Executive KPI Cards with Trend Context & Sparklines */}
      <KPIGrid
        utilization={utilization}
        totalAgents={totalAgents}
        connectedAgents={connectedAgents}
        abandonmentRate={rollingAbandonmentRate}
        totalAbandoned={totalAbandoned}
        inFlightCalls={inFlightCalls}
        connectedConversations={connectedConversations}
        answerRatePct={answerRatePct}
        avgHandlingTimeSec={115}
        safetyInterventions={safetyInterventions}
        history={data.history}
        timeWindow={filters.timeRange}
      />

      {/* 4. Section Navigation Tabs */}
      <nav className="nav-tabs" role="tablist" aria-label="Operations sections">
        <button
          role="tab"
          aria-selected={activeViewTab === 'overview'}
          className={`tab-button ${activeViewTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveViewTab('overview')}
        >
          <span>📊 Operations Overview & Funnel</span>
        </button>
        <button
          role="tab"
          aria-selected={activeViewTab === 'workforce'}
          className={`tab-button ${activeViewTab === 'workforce' ? 'active' : ''}`}
          onClick={() => setActiveViewTab('workforce')}
        >
          <span>👥 Workforce Matrix & Table ({totalAgents} Agents)</span>
        </button>
        <button
          role="tab"
          aria-selected={activeViewTab === 'audit'}
          className={`tab-button ${activeViewTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveViewTab('audit')}
        >
          <span>🛡️ Safety Controller & Operator Audit Trail</span>
        </button>
      </nav>

      {/* 5. Main Section Views */}
      {activeViewTab === 'overview' && (
        <OperationsOverview
          history={data.history}
          funnel={data.funnel}
          carrierA={data.carrierA}
          carrierB={data.carrierB}
        />
      )}

      {activeViewTab === 'workforce' && (
        <WorkforceView
          agents={data.agents}
          agentCounts={data.agentCounts}
        />
      )}

      {activeViewTab === 'audit' && (
        <AuditTrail
          decisions={data.decisions}
        />
      )}

      {/* 6. Destructive Reset Confirmation Modal */}
      <ConfirmModal
        isOpen={isResetModalOpen}
        title="Reset Agent Workforce & Dialer Pool"
        message="This will re-initialize all 50 agent state machines to AVAILABLE, clear in-flight telephony queues, reset the rolling abandonment counter, and log an audit trail entry. This action cannot be undone."
        confirmLabel="Confirm Destructive Reset"
        onConfirm={(reason) => {
          resetSim(reason);
          setIsResetModalOpen(false);
        }}
        onCancel={() => setIsResetModalOpen(false)}
      />

      {/* 7. Floating Toast Notifications */}
      <ToastContainer
        toasts={toasts}
        onDismiss={removeToast}
      />
    </div>
  );
};
