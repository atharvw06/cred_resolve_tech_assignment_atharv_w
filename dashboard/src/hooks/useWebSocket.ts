import { useEffect, useState, useRef } from 'react';
import { DASHBOARD_TOKEN } from '../api/client';

export interface DashboardData {
  agents: Record<string, number>;
  funnel: Record<string, number>;
  decisions: Array<{
    id: string;
    tick_id: number;
    decided_at: string;
    A: number;
    R: number;
    C: number;
    p_hat: number;
    n_proposed: number;
    n_approved: number;
    clamp_reasons: string[];
    mode_used: string;
  }>;
}

export function useWebSocket() {
  const [data, setData] = useState<DashboardData>({
    agents: {
      AVAILABLE: 0,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      WRAP_UP: 0,
      PAUSED: 0,
      OFFLINE: 0,
    },
    funnel: {
      QUEUED: 0,
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
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
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
        reconnectTimeout = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return { data, isConnected };
}
