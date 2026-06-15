import { useState } from "react";
import type { EcoHealth, EcosystemId, EcosystemStatus, PairingState, PrivacyClass } from "../types";
import { PrivacyClassToggle } from "./PrivacyClassToggle";
import { PairingQRCode } from "./PairingQRCode";

interface EcosystemCardProps {
  ecosystem: EcosystemStatus;
  /** Apple: start HAP advertising so the Home app can discover RuView. */
  onPair?: (id: EcosystemId) => Promise<void> | void;
  /** Apple: retract + re-advertise to recover a stuck pairing. */
  onRepair?: (id: EcosystemId) => Promise<void> | void;
  /** Matter: begin commissioning into this ecosystem's fabric. */
  onCommission?: (id: EcosystemId) => Promise<void> | void;
  onPrivacyChange?: (id: EcosystemId, next: PrivacyClass) => void;
  /** Matter 11-digit manual setup code (shared by all Matter ecosystems). */
  matterCode?: string | null;
  /** Matter QR payload string (null until v0.7.1). */
  matterQr?: string | null;
}

const VENDOR: Record<
  EcosystemId,
  { name: string; icon: string; app: string; sensorAs: string; steps: React.ReactNode[] }
> = {
  apple_home: {
    name: "Apple Home",
    icon: "\u{1F3E0}",
    app: "Home",
    sensorAs: "an occupancy & motion sensor",
    steps: [
      <>Open the <b>Home</b> app on your iPhone or iPad</>,
      <>Tap <b>+</b> → <b>Add Accessory</b></>,
      <>Tap <b>More options…</b> and pick <b>RuView Sense</b></>,
      <>Scan the QR or enter the <b>setup&nbsp;PIN</b> below</>,
    ],
  },
  google_home: {
    name: "Google Home",
    icon: "\u{1F50A}",
    app: "Google Home",
    sensorAs: "a Matter occupancy sensor",
    steps: [
      <>Open the <b>Google&nbsp;Home</b> app</>,
      <>Tap <b>+</b> → <b>Set up device</b> → <b>New device</b></>,
      <>Choose <b>Matter-enabled device</b></>,
      <>Scan the QR or enter the <b>11-digit code</b> below</>,
    ],
  },
  amazon_alexa: {
    name: "Amazon Alexa",
    icon: "\u{1F4AC}",
    app: "Alexa",
    sensorAs: "a Matter occupancy sensor",
    steps: [
      <>Open the <b>Alexa</b> app</>,
      <><b>Devices</b> → <b>+</b> → <b>Add Device</b></>,
      <>Choose <b>Other</b> → <b>Matter</b></>,
      <>Scan the QR or enter the <b>11-digit code</b> below</>,
    ],
  },
  smartthings: {
    name: "SmartThings",
    icon: "\u{1F4F1}",
    app: "SmartThings",
    sensorAs: "a Matter occupancy sensor",
    steps: [
      <>Open the <b>SmartThings</b> app</>,
      <>Tap <b>+</b> → <b>Add device</b> → <b>Scan QR code</b></>,
      <>Scan RuView's <b>Matter QR</b> (or enter the code below)</>,
      <>Confirm and assign a room</>,
    ],
  },
};

const PAIRING_STYLE: Record<PairingState, { color: string; label: string }> = {
  paired: { color: "var(--status-online)", label: "Connected" },
  unpaired: { color: "var(--text-muted)", label: "Not added" },
  error: { color: "var(--status-error)", label: "Error" },
};

const HEALTH_COLOR: Record<EcoHealth, string> = {
  ok: "var(--status-online)",
  degraded: "var(--status-warning)",
  down: "var(--status-error)",
};

const MATTER_BANNER = "Matter SDK: scaffolding only — full commissioning in v0.7.1";

function isMatter(eco: EcosystemStatus): boolean {
  return eco.protocol.startsWith("matter");
}

function PairingBadge({ state }: { state: PairingState }) {
  const { color, label } = PAIRING_STYLE[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        padding: "2px 8px",
        borderRadius: 9999,
        lineHeight: 1,
        whiteSpace: "nowrap",
        background: "rgba(255, 255, 255, 0.04)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: color,
          boxShadow: state === "paired" ? `0 0 4px ${color}, 0 0 8px ${color}` : "none",
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}

function ActionButton({
  label,
  title,
  onClick,
  disabled,
  busy,
  primary = true,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        padding: "var(--space-2) var(--space-3)",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled || busy ? "not-allowed" : "pointer",
        border: primary ? "none" : "1px solid var(--border)",
        background: primary ? "var(--accent)" : "transparent",
        color: primary ? "var(--accent-contrast, #fff)" : "var(--text-secondary)",
        opacity: disabled ? 0.45 : busy ? 0.6 : 1,
        transition: "0.2s",
      }}
    >
      {busy ? "…" : label}
    </button>
  );
}

/**
 * One ecosystem card (ADR-172 §2.6), framed around the CORRECT pairing model:
 * RuView is the *accessory* (a sensor); the end-user *adds it* from inside
 * their ecosystem app (Apple Home / Google Home / Alexa / SmartThings) by
 * scanning RuView's code. The card therefore leads with "Add RuView to
 * {vendor}", shows the setup code/QR + per-ecosystem steps, and the action
 * starts RuView *advertising* (so the ecosystem can discover it) rather than
 * implying RuView reaches out to the user's devices.
 *
 * When the live path's feature flag is absent the code is still shown as a
 * setup *preview* and the advertise/commission action is disabled with an
 * explanatory note (Matter cards show the "scaffolding only" banner).
 */
export function EcosystemCard({
  ecosystem,
  onPair,
  onRepair,
  onCommission,
  onPrivacyChange,
  matterCode,
  matterQr,
}: EcosystemCardProps) {
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const vendor = VENDOR[ecosystem.id];
  const matter = isMatter(ecosystem);
  const featureOff = !ecosystem.feature_available;
  const applePin =
    (ecosystem.details && (ecosystem.details as Record<string, unknown>).setup_pin) || null;

  const run = (kind: string, fn?: (id: EcosystemId) => Promise<void> | void) => async () => {
    if (!fn || actionInFlight) return;
    setActionInFlight(kind);
    try {
      await fn(ecosystem.id);
    } finally {
      setActionInFlight(null);
    }
  };

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      {/* Header: icon + name + connection badge + health dot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            aria-hidden
            style={{
              fontSize: 18,
              width: 32,
              height: 32,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              background: "var(--accent-dim)",
            }}
          >
            {vendor.icon}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              {vendor.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {ecosystem.protocol}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <PairingBadge state={ecosystem.pairing} />
          <span
            title={`Health: ${ecosystem.health}`}
            aria-label={`Health: ${ecosystem.health}`}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: HEALTH_COLOR[ecosystem.health],
              boxShadow:
                ecosystem.health === "ok" ? `0 0 6px ${HEALTH_COLOR[ecosystem.health]}` : "none",
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      {/* Reframe: RuView is the sensor; you add it from the vendor app. */}
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--text-secondary)" }}>
        RuView appears as {vendor.sensorAs} in{" "}
        <b style={{ color: "var(--text-primary)" }}>{vendor.name}</b>. Add it from the{" "}
        <b style={{ color: "var(--text-primary)" }}>{vendor.app}</b> app using the setup code below.
      </p>

      {/* Scaffolding banner for Matter cards without the SDK */}
      {matter && featureOff && (
        <div
          role="status"
          style={{
            padding: "var(--space-2) var(--space-3)",
            background: "rgba(212, 165, 116, 0.12)",
            border: "1px solid rgba(212, 165, 116, 0.3)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--status-warning)",
            lineHeight: 1.4,
          }}
        >
          {MATTER_BANNER}
        </div>
      )}

      {/* Apple note when hap-server is absent */}
      {!matter && featureOff && (
        <div
          role="status"
          style={{
            padding: "var(--space-2) var(--space-3)",
            background: "rgba(212, 165, 116, 0.12)",
            border: "1px solid rgba(212, 165, 116, 0.3)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--status-warning)",
            lineHeight: 1.4,
          }}
        >
          Built without the <code>hap-server</code> feature — advertising is unavailable; the code
          below is a setup preview.
        </div>
      )}

      {/* Privacy toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 48 }}>Privacy</span>
        <PrivacyClassToggle
          ecosystem={ecosystem.id}
          value={ecosystem.privacy_class}
          onChange={(next) => onPrivacyChange?.(ecosystem.id, next)}
        />
      </div>

      {/* Expandable "Add to {vendor}" setup: code/QR + steps */}
      <button
        type="button"
        onClick={() => setShowSetup((s) => !s)}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--accent)",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "var(--font-sans)",
        }}
        aria-expanded={showSetup}
      >
        {showSetup ? "▾ Hide setup steps" : `▸ How to add to ${vendor.name}`}
      </button>

      {showSetup && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "var(--space-4)",
            alignItems: "start",
            padding: "var(--space-3)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <PairingQRCode
            kind={matter ? "matter" : "hap"}
            payload={matter ? matterQr ?? null : null}
            manualCode={matter ? matterCode ?? undefined : undefined}
            pin={!matter ? ((applePin as string) ?? undefined) : undefined}
          />
          <ol className="cog-steps">
            {vendor.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Action: RuView starts ADVERTISING so the ecosystem can find it. */}
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "auto" }}>
        {matter ? (
          <ActionButton
            label="Begin commissioning"
            title={
              featureOff
                ? "Matter commissioning lands in v0.7.1 (rs-matter SDK)"
                : "Open RuView's Matter fabric for this ecosystem"
            }
            onClick={run("commission", onCommission)}
            disabled={featureOff}
            busy={actionInFlight === "commission"}
          />
        ) : (
          <>
            <ActionButton
              label="Start advertising"
              title={
                featureOff
                  ? "Requires the hap-server feature"
                  : "Broadcast RuView so the Home app can discover it"
              }
              onClick={run("pair", onPair)}
              disabled={featureOff}
              busy={actionInFlight === "pair"}
            />
            <ActionButton
              label="Re-advertise"
              title="Retract and re-broadcast to recover a stuck pairing"
              onClick={run("repair", onRepair)}
              disabled={featureOff}
              busy={actionInFlight === "repair"}
              primary={false}
            />
          </>
        )}
      </div>
    </div>
  );
}
