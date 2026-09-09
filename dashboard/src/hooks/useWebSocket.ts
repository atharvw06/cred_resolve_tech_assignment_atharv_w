import { useEffect, useState, useRef, useCallback } from 'react';
import { DASHBOARD_TOKEN } from '../api/client';
import { ClientDialerEngine, DecisionRow } from '../sim/clientSim';

export interface DashboardData {
  agents: Record<string, number>;
  funnel: Record<string, number>;
  decisions: DecisionRow[];
}

export function useWebSocket() {
  const [data, setData] = useState<DashboardData>({
    agents: {
      AVAILABLE: 50,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      WRAP_UP: 0,
      PAUSED: 0,
      OFFLINE: 0,
    },
    funnel: {
      QUEUED: 500,
      RESERVED: 0,
      INITIATED: 0,
      RINGING: 0,
      ANSWERED: 0,
      CONNECTED: 0,
      COMPLETED: 0,
      FAILED: 0,
      ABANDONED: 0,
    },
    decisions: [],
  });

  const [isConnected, setIsConnected] = useState(false);
  const [isSimRunning, setIsSimRunning] = useState(true);
  const [scenario, setScenario] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [mode, setMode] = useState<'PREDICTIVE' | 'PROGRESSIVE'>('PREDICTIVE');

  const wsRef = useRef<WebSocket | null>(null);
  const engineRef = useRef<ClientDialerEngine>(new ClientDialerEngine());

  // WebSocket live backend connection attempt
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        const wsUrl = `ws://localhost:8000/ws/dashboard?token=${DASHBOARD_TOKEN}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'SNAPSHOT') {
              setData({
                agents: payload.agents || {},
                funnel: payload.funnel || {},
                decisions: payload.decisions || [],
              });
            }
          } catch (e) {
            console.error('Error parsing dashboard WS frame:', e);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 4000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        setIsConnected(false);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Client-side auto simulation loop when WebSocket is not connected or when sim is active
  useEffect(() => {
    if (isConnected) return; // Backend is feeding data

    const engine = engineRef.current;
    engine.scenario = scenario;
    engine.mode = mode;

    let intervalId: ReturnType<typeof setInterval>;
    if (isSimRunning) {
      intervalId = setInterval(() => {
        const tickRes = engine.tick();
        setData(tickRes);
      }, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isConnected, isSimRunning, scenario, mode]);

  const toggleSim = useCallback(() => {
    setIsSimRunning((prev) => !prev);
  }, []);

  const resetSim = useCallback(() => {
    engineRef.current.reset(50);
    setData({
      agents: { ...engineRef.current.agents },
      funnel: { ...engineRef.current.funnel },
      decisions: [],
    });
  }, []);

  const changeScenario = useCallback((s: 'A' | 'B' | 'C' | 'D') => {
    setScenario(s);
    engineRef.current.scenario = s;
  }, []);

  const changeMode = useCallback((m: 'PREDICTIVE' | 'PROGRESSIVE') => {
    setMode(m);
    engineRef.current.mode = m;
  }, []);

  return {
    data,
    isConnected,
    isSimRunning,
    scenario,
    mode,
    toggleSim,
    resetSim,
    changeScenario,
    changeMode,
  };
}
