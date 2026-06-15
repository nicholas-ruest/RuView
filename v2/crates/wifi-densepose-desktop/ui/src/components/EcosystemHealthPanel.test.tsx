import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EcosystemHealthPanel } from "./EcosystemHealthPanel";
import type { HealthReport } from "../types";

const report: HealthReport = {
  window_hours: 24,
  ecosystems: [
    {
      ecosystem: "apple_home",
      samples: [
        { t_ms: 1, delivered: true, latency_ms: 180 },
        { t_ms: 2, delivered: true, latency_ms: 190 },
        { t_ms: 3, delivered: true, latency_ms: 175 },
      ],
      delivered: 3,
      total: 3,
      error_rate: 0,
      avg_latency_ms: 181.67,
      recommission_alerts: 0,
    },
    {
      ecosystem: "google_home",
      samples: [
        { t_ms: 1, delivered: false },
        { t_ms: 2, delivered: true, latency_ms: 210 },
      ],
      delivered: 1,
      total: 2,
      error_rate: 0.5,
      avg_latency_ms: 210,
      recommission_alerts: 2,
    },
  ],
};

describe("EcosystemHealthPanel", () => {
  it("renders nothing when no report", () => {
    const { container } = render(<EcosystemHealthPanel report={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a row per ecosystem with the window header", () => {
    render(<EcosystemHealthPanel report={report} />);
    expect(screen.getByText(/last 24 h/i)).toBeInTheDocument();
    expect(screen.getByTestId("health-row-apple_home")).toBeInTheDocument();
    expect(screen.getByTestId("health-row-google_home")).toBeInTheDocument();
  });

  it("surfaces the re-commission alert count", () => {
    render(<EcosystemHealthPanel report={report} />);
    expect(screen.getByTestId("recommission-google_home")).toHaveTextContent("2");
    expect(screen.getByTestId("recommission-apple_home")).toHaveTextContent("0");
  });

  it("renders a latency sparkline when there are >=2 delivered samples", () => {
    render(<EcosystemHealthPanel report={report} />);
    // Apple has 3 delivered samples → an SVG sparkline is drawn.
    expect(
      screen.getByLabelText(/Apple Home latency sparkline/i),
    ).toBeInTheDocument();
  });
});
