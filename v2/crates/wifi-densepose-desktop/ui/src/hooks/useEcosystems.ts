import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EcosystemId,
  EcosystemStatus,
  HealthReport,
  PingResult,
  PrivacyClass,
} from "../types";
import {
  getEcosystemsConfig,
  getHealth,
  getStatus,
  pingAll as pingAllApi,
  setPrivacy as setPrivacyApi,
} from "../api/ecosystems";

interface UseEcosystemsOptions {
  /** Polling-fallback interval in ms when the WS is unavailable. Default 5000. */
  pollInterval?: number;
}

interface UseEcosystemsReturn {
  status: EcosystemStatus[];
  isLoading: boolean;
  error: string | null;
  /** True while a live WebSocket subscription is active. */
  wsConnected: boolean;
  /** Commissioning log lines streamed over the WS. */
  commissioningLog: string[];
  refetch: () => Promise<void>;
  setPrivacy: (id: EcosystemId, next: PrivacyClass) => Promise<boolean>;
  pingAll: () => Promise<PingResult[]>;
  /** Optimistically merge a delta into local status (used by child components). */
  applyDelta: (delta: EcosystemStatus) => void;
  /** P4 — longitudinal health report (last 24 h), refreshed on poll. */
  health: HealthReport | null;
  refetchHealth: () => Promise<void>;
}

const WS_PATH = "/api/websocket";
const WS_RECONNECT_DELAY_MS = 3000;
const MAX_LOG_LINES = 200;

function mergeStatus(prev: EcosystemStatus[], delta: EcosystemStatus): EcosystemStatus[] {
  const idx = prev.findIndex((e) => e.id === delta.id);
  if (idx === -1) return [...prev, delta];
  const next = [...prev];
  next[idx] = delta;
  return next;
}

/**
 * ECO-FABRIC dashboard state hook (ADR-172 §2.4). Seeds from GET /status,
 * subscribes to the HOMECORE WebSocket for `ecosystem_status_changed` deltas,
 * and falls back to polling GET /status every `pollInterval` ms when the WS
 * cannot be established.
 */
export function useEcosystems(options: UseEcosystemsOptions = {}): UseEcosystemsReturn {
  const { pollInterval = 5000 } = options;

  const [status, setStatus] = useState<EcosystemStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [commissioningLog, setCommissioningLog] = useState<string[]>([]);
  const [health, setHealth] = useState<HealthReport | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnectedRef = useRef(false);
  wsConnectedRef.current = wsConnected;

  const refetch = useCallback(async () => {
    const res = await getStatus();
    if (res.ok) {
      setStatus(res.data.ecosystems);
      setError(null);
    } else {
      setError(res.error.message);
    }
    setIsLoading(false);
  }, []);

  const applyDelta = useCallback((delta: EcosystemStatus) => {
    setStatus((prev) => mergeStatus(prev, delta));
  }, []);

  // Initial seed.
  useEffect(() => {
    refetch();
  }, [refetch]);

  // WebSocket subscription with polling fallback.
  useEffect(() => {
    let cancelled = false;

    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        // Only poll while the WS is not live.
        if (!wsConnectedRef.current) refetch();
      }, pollInterval);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      const { baseUrl, token } = getEcosystemsConfig();
      const wsUrl = baseUrl.replace(/^http/, "ws") + WS_PATH;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        startPolling();
        return;
      }

      ws.onopen = () => {
        // HOMECORE handshake: authenticate, then subscribe.
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }

        if (msg.type === "auth_ok") {
          setWsConnected(true);
          stopPolling();
          ws.send(
            JSON.stringify({
              type: "subscribe_events",
              event_type: "ecosystem_status_changed",
            }),
          );
          return;
        }

        if (msg.type === "auth_invalid" || msg.type === "auth_error") {
          // Auth failed — fall back to polling (still authenticated via REST).
          ws.close();
          return;
        }

        // HOMECORE wraps domain events as
        // `{ id, type: "event", event: { event_type, data, ... } }`
        // (ADR-130 / ws.rs). The ecosystems backend (ADR-172) fires
        // `ecosystem_status_changed` carrying the FULL status snapshot
        // (`{ ecosystems: [...] }`) — so we replace the whole array
        // rather than merging a single-card delta.
        if (msg.type === "event" && msg.event && typeof msg.event === "object") {
          const ev = msg.event as Record<string, unknown>;
          const etype = ev.event_type as string | undefined;
          const data = ev.data as Record<string, unknown> | undefined;

          if (etype === "ecosystem_status_changed" && data && Array.isArray(data.ecosystems)) {
            setStatus(data.ecosystems as EcosystemStatus[]);
            setError(null);
            return;
          }

          if (etype === "matter_commissioning_log" && data && typeof data.line === "string") {
            const line = data.line as string;
            setCommissioningLog((prev) => {
              const next = [...prev, line];
              return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
            });
            return;
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        startPolling();
        if (!cancelled) {
          reconnectRef.current = setTimeout(connect, WS_RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        // onclose will follow; ensure polling covers the gap.
        startPolling();
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      stopPolling();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [pollInterval, refetch, applyDelta]);

  const setPrivacy = useCallback(
    async (id: EcosystemId, next: PrivacyClass): Promise<boolean> => {
      const res = await setPrivacyApi(id, next);
      if (res.ok && res.data.applied) {
        setStatus((prev) =>
          prev.map((e) => (e.id === id ? { ...e, privacy_class: res.data.privacy_class } : e)),
        );
        return true;
      }
      return false;
    },
    [],
  );

  const refetchHealth = useCallback(async () => {
    const res = await getHealth(24);
    if (res.ok) setHealth(res.data);
  }, []);

  const pingAll = useCallback(async (): Promise<PingResult[]> => {
    const res = await pingAllApi();
    // A ping records a fresh health datapoint server-side — refresh the chart.
    void refetchHealth();
    return res.ok ? res.data.results : [];
  }, [refetchHealth]);

  // Seed + periodically refresh the longitudinal health report.
  useEffect(() => {
    refetchHealth();
    const id = setInterval(refetchHealth, Math.max(pollInterval, 5000));
    return () => clearInterval(id);
  }, [refetchHealth, pollInterval]);

  return {
    status,
    isLoading,
    error,
    wsConnected,
    commissioningLog,
    refetch,
    setPrivacy,
    pingAll,
    applyDelta,
    health,
    refetchHealth,
  };
}
