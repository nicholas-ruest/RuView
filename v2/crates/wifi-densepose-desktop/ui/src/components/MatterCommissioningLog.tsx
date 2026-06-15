import { useEffect, useRef } from "react";

interface MatterCommissioningLogProps {
  /** Commissioning log lines streamed over the WebSocket. */
  lines: string[];
}

/**
 * Autoscrolling monospace (JetBrains Mono) log pane fed by WS lines
 * (ADR-172 §2.6). Used to watch a Matter pairing succeed or diagnose a failure.
 */
export function MatterCommissioningLog({ lines }: MatterCommissioningLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
        }}
      >
        Matter Commissioning Log
      </div>
      <div
        ref={containerRef}
        style={{
          height: 180,
          overflowY: "auto",
          padding: "var(--space-2) var(--space-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.7,
          color: "var(--text-secondary)",
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: "var(--text-muted)", padding: "var(--space-3)", textAlign: "center" }}>
            No commissioning activity.
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
