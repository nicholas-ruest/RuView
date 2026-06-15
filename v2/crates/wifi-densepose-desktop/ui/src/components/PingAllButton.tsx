import { useState } from "react";
import type { PingResult } from "../types";
import { pingAll } from "../api/ecosystems";

interface PingAllButtonProps {
  /** Optional override for the ping action (used in tests). */
  onPing?: () => Promise<PingResult[]>;
}

const ECO_LABEL: Record<string, string> = {
  apple_home: "Apple Home",
  google_home: "Google Home",
  amazon_alexa: "Amazon Alexa",
  smartthings: "SmartThings",
};

/**
 * POSTs /ping-all and shows per-ecosystem delivered/latency or the failure
 * reason (ADR-172 §2.6 / §4 P3 acceptance).
 */
export function PingAllButton({ onPing }: PingAllButtonProps) {
  const [inFlight, setInFlight] = useState(false);
  const [results, setResults] = useState<PingResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (inFlight) return;
    setInFlight(true);
    setError(null);
    try {
      if (onPing) {
        setResults(await onPing());
      } else {
        const res = await pingAll();
        if (res.ok) {
          setResults(res.data.results);
        } else {
          setError(res.error.message);
          setResults([]);
        }
      }
    } finally {
      setInFlight(false);
    }
  };

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "var(--space-4)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            Test Delivery
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            Emit a synthetic event to every paired ecosystem.
          </div>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={inFlight}
          style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: inFlight ? "not-allowed" : "pointer",
            background: "var(--accent)",
            color: "#fff",
            opacity: inFlight ? 0.6 : 1,
          }}
        >
          {inFlight ? "Pinging..." : "Ping All"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: "var(--space-3)",
            fontSize: 12,
            color: "var(--status-error)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: 6 }}>
          {results.map((r) => (
            <div
              key={r.ecosystem}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                fontSize: 12,
                padding: "var(--space-1) var(--space-2)",
                background: "var(--bg-base)",
                borderRadius: 4,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: r.delivered ? "var(--status-online)" : "var(--status-error)",
                  flexShrink: 0,
                }}
              />
              <span style={{ minWidth: 110, color: "var(--text-primary)", fontWeight: 500 }}>
                {ECO_LABEL[r.ecosystem] ?? r.ecosystem}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: r.delivered ? "var(--text-secondary)" : "var(--status-error)",
                }}
              >
                {r.delivered
                  ? `delivered${r.latency_ms != null ? ` · ${r.latency_ms} ms` : ""}`
                  : `failed${r.reason ? ` · ${r.reason}` : ""}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
