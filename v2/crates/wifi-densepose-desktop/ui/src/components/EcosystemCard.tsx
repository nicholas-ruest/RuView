import { useState } from "react";
import type { EcoHealth, EcosystemId, EcosystemStatus, PairingState, PrivacyClass } from "../types";
import { PrivacyClassToggle } from "./PrivacyClassToggle";

interface EcosystemCardProps {
  ecosystem: EcosystemStatus;
  onPair?: (id: EcosystemId) => Promise<void> | void;
  onRepair?: (id: EcosystemId) => Promise<void> | void;
  onCommission?: (id: EcosystemId) => Promise<void> | void;
  onPrivacyChange?: (id: EcosystemId, next: PrivacyClass) => void;
}

const VENDOR: Record<EcosystemId, { name: string; icon: string }> = {
  apple_home: { name: "Apple Home", icon: "\u{1F3E0}" }, // house
  google_home: { name: "Google Home", icon: "\u{1F50A}" }, // speaker
  amazon_alexa: { name: "Amazon Alexa", icon: "\u{1F4AC}" }, // speech
  smartthings: { name: "SmartThings", icon: "\u{1F4F1}" }, // phone
};

const PAIRING_STYLE: Record<PairingState, { color: string; label: string }> = {
  paired: { color: "var(--status-online)", label: "Paired" },
  unpaired: { color: "var(--text-muted)", label: "Unpaired" },
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
  onClick,
  disabled,
  busy,
  primary = true,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        padding: "var(--space-1) var(--space-3)",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled || busy ? "not-allowed" : "pointer",
        border: primary ? "none" : "1px solid var(--border)",
        background: primary ? "var(--accent)" : "transparent",
        color: primary ? "#fff" : "var(--text-secondary)",
        opacity: disabled ? 0.4 : busy ? 0.6 : 1,
      }}
    >
      {busy ? "..." : label}
    </button>
  );
}

/**
 * One ecosystem card (ADR-172 §2.6): vendor name/icon, pairing badge, health
 * dot, a PrivacyClassToggle, and pair/repair/commission actions. When the live
 * path's feature flag is absent the write actions are disabled with an
 * explanatory note — Matter cards show the "scaffolding only" banner.
 */
export function EcosystemCard({
  ecosystem,
  onPair,
  onRepair,
  onCommission,
  onPrivacyChange,
}: EcosystemCardProps) {
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const vendor = VENDOR[ecosystem.id];
  const matter = isMatter(ecosystem);
  const featureOff = !ecosystem.feature_available;

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
        borderRadius: 8,
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      {/* Header: icon + name + pairing badge + health dot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ fontSize: 20 }} aria-hidden>
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

      {/* Scaffolding banner for Matter cards without the SDK */}
      {matter && featureOff && (
        <div
          role="status"
          style={{
            padding: "var(--space-2) var(--space-3)",
            background: "rgba(210, 153, 34, 0.12)",
            border: "1px solid rgba(210, 153, 34, 0.3)",
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
            background: "rgba(210, 153, 34, 0.12)",
            border: "1px solid rgba(210, 153, 34, 0.3)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--status-warning)",
            lineHeight: 1.4,
          }}
        >
          Built without the <code>hap-server</code> feature — pairing is unavailable.
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

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "auto" }}>
        {matter ? (
          <ActionButton
            label="Commission"
            onClick={run("commission", onCommission)}
            disabled={featureOff}
            busy={actionInFlight === "commission"}
          />
        ) : (
          <>
            <ActionButton
              label="Pair"
              onClick={run("pair", onPair)}
              disabled={featureOff}
              busy={actionInFlight === "pair"}
            />
            <ActionButton
              label="Re-pair"
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
