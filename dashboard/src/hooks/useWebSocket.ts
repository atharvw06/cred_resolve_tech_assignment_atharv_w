import { useEffect, useState, useRef, useCallback } from 'react';
import { DASHBOARD_TOKEN } from '../api/client';
import { ClientDialerEngine, CarrierStats } from '../sim/clientSim';
import {
  AgentRecord,
  AgentStatus,
  DecisionRow,
  FunnelMetrics,
  ScenarioKey,
  PacingMode,
  TimeSeriesPoint,
  ToastMessage,
  GlobalFilters,
} from '../types';

export interface DashboardState {
  agents: AgentRecord[];
  agentCounts: Record<AgentStatus, number>;
  funnel: FunnelMetrics;
  decisions: DecisionRow[];
  history: TimeSeriesPoint[];
  carrierA: CarrierStats;
  carrierB: CarrierStats;
}

export function useWebSocket() {
  const engineRef = useRef<ClientDialerEngine>(new ClientDialerEngine());

  const [data, setData] = useState<DashboardState>(() => {
    const engine = engineRef.current;
    return {
      agents: [...engine.agents],
      agentCounts: engine.getCountsByStatus(),
      funnel: { ...engine.funnel },
      decisions: [...engine.decisions],
      history: [...engine.history],
      carrierA: { ...engine.carrierA },
      carrierB: { ...engine.carrierB },
    };
  });

  const [connectionStatus, setConnectionStatus] = useState<'LIVE' | 'RECONNECTING' | 'SIMULATOR'>('SIMULATOR');
  const [isSimRunning, setIsSimRunning] = useState<boolean>(true);
  const [scenario, setScenario] = useState<ScenarioKey>('A');
  const [mode, setMode] = useState<PacingMode>('PREDICTIVE');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [filters, setFilters] = useState<GlobalFilters>({
    timeRange: '15m',
    campaign: 'All',
    queue: 'All',
    carrier: 'All',
    team: 'All',
    scenario: 'A',
    searchQuery: '',
  });

  const wsRef = useRef<WebSocket | null>(null);

  const addToast = useCallback(
    (title: string, message: string, type: 'success' | 'warning' | 'info' | 'error' = 'info') => {
      const toast: ToastMessage = {
        id: `toast_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        title,
        message,
        type,
        timestamp: new Date().toLocaleTimeString(),
      };
      setToasts((prev) => [toast, ...prev].slice(0, 5));
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Backend WebSocket Connection Attempt
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        const wsUrl = `ws://localhost:8000/ws/dashboard?token=${DASHBOARD_TOKEN}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnectionStatus('LIVE');
          addToast('WebSocket Connected', 'Streaming real-time telephony telemetry from FastAPI daemon', 'success');
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'SNAPSHOT') {
              setLastUpdated(new Date());
              // Integrate backend data if available
            }
          } catch (e) {
            console.error('Error parsing dashboard WS frame:', e);
          }
        };

        ws.onclose = () => {
          setConnectionStatus('SIMULATOR');
          reconnectTimeout = setTimeout(connect, 6000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        setConnectionStatus('SIMULATOR');
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [addToast]);

  // Client simulation loop (runs when backend WS is in simulator mode)
  useEffect(() => {
    if (connectionStatus === 'LIVE') return;

    const engine = engineRef.current;
    engine.scenario = scenario;
    engine.mode = mode;

    let intervalId: ReturnType<typeof setInterval>;
    if (isSimRunning) {
      intervalId = setInterval(() => {
        const tickRes = engine.tick();
        setData(tickRes);
        setLastUpdated(new Date());
      }, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [connectionStatus, isSimRunning, scenario, mode]);

  const toggleSim = useCallback(
    (reason = 'Operator toggled pacing status') => {
      setIsSimRunning((prev) => {
        const nextState = !prev;
        engineRef.current.recordOperatorAction(
          nextState ? 'Resume Pacing' : 'Pause Pacing',
          reason,
          nextState ? 'INFO' : 'WARNING'
        );
        addToast(
          nextState ? 'Pacing Resumed' : 'Pacing Paused',
          nextState ? 'Dialer pacing engine is active.' : 'Outbound telephony placement safely halted.',
          nextState ? 'success' : 'warning'
        );
        return nextState;
      });
    },
    [addToast]
  );

  const resetSim = useCallback(
    (reason: string) => {
      engineRef.current.reset(50);
      engineRef.current.recordOperatorAction('Reset Agent & Funnel Pool', reason, 'WARNING');
      setData({
        agents: [...engineRef.current.agents],
        agentCounts: engineRef.current.getCountsByStatus(),
        funnel: { ...engineRef.current.funnel },
        decisions: [...engineRef.current.decisions],
        history: [...engineRef.current.history],
        carrierA: { ...engineRef.current.carrierA },
        carrierB: { ...engineRef.current.carrierB },
      });
      addToast('Pool Reset Completed', `Agent workforce and funnel re-initialized. Reason: ${reason}`, 'info');
    },
    [addToast]
  );

  const changeScenario = useCallback(
    (s: ScenarioKey) => {
      setScenario(s);
      engineRef.current.scenario = s;
      setFilters((prev) => ({ ...prev, scenario: s }));
      const desc =
        s === 'A'
          ? 'Scenario A (20% answer rate, nominal collections)'
          : s === 'B'
          ? 'Scenario B (50% answer rate, high connectivity)'
          : s === 'C'
          ? 'Scenario C (70% stress test, high abandonment risk)'
          : 'Scenario D (Telecom drift chaos & carrier failover)';
      engineRef.current.recordOperatorAction(`Switched Scenario to ${s}`, desc, 'INFO');
      addToast(`Scenario ${s} Activated`, desc, 'info');
    },
    [addToast]
  );

  const changeMode = useCallback(
    (m: PacingMode) => {
      setMode(m);
      engineRef.current.mode = m;
      const desc =
        m === 'PREDICTIVE'
          ? 'Predictive pacing active with quadratic binomial safety bound'
          : 'Progressive pacing active (deterministic 1:1 agent dials)';
      engineRef.current.recordOperatorAction(`Switched Mode to ${m}`, desc, 'INFO');
      addToast(`Pacing Mode: ${m}`, desc, 'info');
    },
    [addToast]
  );

  return {
    data,
    connectionStatus,
    isSimRunning,
    scenario,
    mode,
    lastUpdated,
    toasts,
    filters,
    setFilters,
    addToast,
    removeToast,
    toggleSim,
    resetSim,
    changeScenario,
    changeMode,
  };
}
