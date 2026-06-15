import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EcosystemCard } from "./EcosystemCard";
import type { EcosystemStatus } from "../types";

function matterEco(overrides: Partial<EcosystemStatus> = {}): EcosystemStatus {
  return {
    id: "google_home",
    protocol: "matter-1.4",
    pairing: "unpaired",
    health: "ok",
    feature_available: false,
    privacy_class: 3,
    details: { fabric_id: null, sdk_status: "scaffolding-only" },
    ...overrides,
  };
}

function appleEco(overrides: Partial<EcosystemStatus> = {}): EcosystemStatus {
  return {
    id: "apple_home",
    protocol: "hap-1.1",
    pairing: "paired",
    health: "ok",
    feature_available: true,
    privacy_class: 2,
    details: { mdns_advertised: true, setup_pin: "031-45-154" },
    ...overrides,
  };
}

describe("EcosystemCard", () => {
  it("shows the scaffolding banner and disables commissioning when feature_available is false", () => {
    render(<EcosystemCard ecosystem={matterEco()} onCommission={vi.fn()} />);

    expect(
      screen.getByText(/Matter SDK: scaffolding only — full commissioning in v0.7.1/i),
    ).toBeInTheDocument();

    const commission = screen.getByRole("button", { name: /begin commissioning/i });
    expect(commission).toBeDisabled();
  });

  it("enables commissioning when the Matter SDK feature is available", () => {
    render(
      <EcosystemCard
        ecosystem={matterEco({ feature_available: true })}
        onCommission={vi.fn()}
      />,
    );

    expect(screen.queryByText(/scaffolding only/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /begin commissioning/i })).toBeEnabled();
  });

  it("disables Apple advertising with a note when hap-server is absent", () => {
    render(
      <EcosystemCard
        ecosystem={appleEco({ feature_available: false })}
        onPair={vi.fn()}
        onRepair={vi.fn()}
      />,
    );

    expect(screen.getByText(/hap-server/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start advertising/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /re-advertise/i })).toBeDisabled();
  });

  it("frames RuView as the accessory and surfaces the connection state", () => {
    render(<EcosystemCard ecosystem={appleEco()} onPair={vi.fn()} onRepair={vi.fn()} />);

    // Connection badge (reframed from "Paired" → "Connected").
    expect(screen.getByText("Connected")).toBeInTheDocument();
    // The card explains the correct direction of the flow.
    expect(screen.getByText(/Add it from the/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start advertising/i })).toBeEnabled();
    // The per-ecosystem "how to add" disclosure is present.
    expect(screen.getByRole("button", { name: /how to add to apple home/i })).toBeInTheDocument();
  });
});
