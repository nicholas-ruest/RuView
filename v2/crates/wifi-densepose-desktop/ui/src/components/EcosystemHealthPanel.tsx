/**
 * ADR-172 P4 — longitudinal ecosystem health.
 *
 * Renders, per ecosystem over the look-back window: a latency sparkline
 * (delivered datapoints), the delivery/error rate, the mean latency, and
 * the Matter fabric re-commissioning alert count. Data comes from
 * `GET /api/v1/ecosystems/health`.
 */
import type { EcoHealthSeries, HealthReport } from "../types";

const ECO_LABELS: Record<string, string> = {
  apple_home: "Apple Home",
  google_home: "Google Home",
  amazon_alexa: "Amazon Alexa",
  smartthings: "SmartThings",
};

/** Inline SVG sparkline of delivered-sample latencies (no chart lib). */
function LatencySparkline({ series }: { series: EcoHealthSeries }) {
  const pts = series.samples
    .filter((s) => s.delivered && typeof s.latency_ms === "number")
    .map((s) => s.latency_ms as number);

  const w = 160;
  const h = 36;
  if (pts.length < 2) {
    return (
      <span className="body-sm" style={{ color: "var(--text-muted)" }}>
        {pts.length === 0 ? "no delivered samples" : "1 sample"}
      </span>
    );
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const dx = w / (pts.length - 1);
  const path = pts
    .map((v, i) => {
      const x = i * dx;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${ECO_LABELS[series.ecosystem] ?? series.ecosystem} latency sparkline`}
    >
      <path d={path} fill="none" stroke="var(--accent, #4ecdc4)" strokeWidth="1.5" />
    </svg>
  );
}

function HealthRow({ series }: { series: EcoHealthSeries }) {
  const errorPct = (series.error_rate * 100).toFixed(0);
  const avg = series.avg_latency_ms != null ? `${series.avg_latency_ms.toFixed(0)} ms` : "—";
  const errColor =
    series.error_rate > 0.25
      ? "var(--status-error, #f85149)"
      : series.error_rate > 0
        ? "var(--status-warning, #d29922)"
        : "var(--status-online, #3fb950)";

  return (
    <tr data-testid={`health-row-${series.ecosystem}`}>
      <td style={{ padding: "var(--space-2)", fontWeight: 500 }}>
        {ECO_LABELS[series.ecosystem] ?? series.ecosystem}
      </td>
      <td style={{ padding: "var(--space-2)" }}>
        <LatencySparkline series={series} />
      </td>
      <td style={{ padding: "var(--space-2)", fontFamily: "var(--font-mono)" }}>{avg}</td>
      <td style={{ padding: "var(--space-2)", fontFamily: "var(--font-mono)", color: errColor }}>
        {errorPct}% <span style={{ color: "var(--text-muted)" }}>({series.total})</span>
      </td>
      <td
        style={{
          padding: "var(--space-2)",
          fontFamily: "var(--font-mono)",
          color: series.recommission_alerts > 0 ? "var(--status-warning, #d29922)" : "var(--text-muted)",
        }}
        data-testid={`recommission-${series.ecosystem}`}
      >
        {series.recommission_alerts}
      </td>
    </tr>
  );
}

export function EcosystemHealthPanel({ report }: { report: HealthReport | null }) {
  if (!report) {
    return null;
  }
  return (
    <section
      data-testid="ecosystem-health-panel"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "var(--space-4)",
        marginTop: "var(--space-5)",
      }}
    >
      <h3 className="heading-sm" style={{ marginBottom: "var(--space-3)" }}>
        Ecosystem health — last {report.window_hours} h
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-muted)" }} className="body-sm">
            <th style={{ padding: "var(--space-2)" }}>Ecosystem</th>
            <th style={{ padding: "var(--space-2)" }}>Latency (24 h)</th>
            <th style={{ padding: "var(--space-2)" }}>Avg</th>
            <th style={{ padding: "var(--space-2)" }}>Error rate</th>
            <th style={{ padding: "var(--space-2)" }}>Re-commission</th>
          </tr>
        </thead>
        <tbody>
          {report.ecosystems.map((s) => (
            <HealthRow key={s.ecosystem} series={s} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
