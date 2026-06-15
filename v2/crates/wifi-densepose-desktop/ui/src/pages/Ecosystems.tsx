import { useEffect, useState } from "react";
import type { EcosystemId, MappingRow, MatterQr } from "../types";
import { useEcosystems } from "../hooks/useEcosystems";
import { EcosystemCard } from "../components/EcosystemCard";
import { PingAllButton } from "../components/PingAllButton";
import { EntityMappingTable } from "../components/EntityMappingTable";
import { MatterCommissioningLog } from "../components/MatterCommissioningLog";
import { EcosystemHealthPanel } from "../components/EcosystemHealthPanel";
import {
  commissionMatter,
  getMappings,
  getMatterQr,
  pairApple,
  repairApple,
  updateMapping,
} from "../api/ecosystems";
import "../styles/cognitum-theme.css";

/**
 * EcosystemsDashboard (ADR-172 §2.6): the ECO-FABRIC container. Owns ecosystem
 * status (seeded by getStatus, updated by WS deltas via useEcosystems), and
 * renders a 2×2 grid of EcosystemCard, a PingAllButton, and an EntityMappingTable.
 */
export const Ecosystems: React.FC = () => {
  const { status, isLoading, error, wsConnected, commissioningLog, refetch, pingAll, health } =
    useEcosystems({ pollInterval: 5000 });

  const [matterQr, setMatterQr] = useState<MatterQr | null>(null);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load the Matter QR + manual code and the mapping table once on mount.
  useEffect(() => {
    getMatterQr().then((res) => {
      if (res.ok) setMatterQr(res.data);
    });
    getMappings().then((res) => {
      if (res.ok) setMappings(res.data);
    });
  }, []);

  const handlePair = async (id: EcosystemId) => {
    setActionError(null);
    const res = await pairApple();
    if (!res.ok) setActionError(`Pair ${id}: ${res.error.message}`);
    await refetch();
  };

  const handleRepair = async (id: EcosystemId) => {
    setActionError(null);
    const res = await repairApple();
    if (!res.ok) setActionError(`Re-pair ${id}: ${res.error.message}`);
    await refetch();
  };

  const handleCommission = async (id: EcosystemId) => {
    setActionError(null);
    const res = await commissionMatter(id);
    if (!res.ok) setActionError(`Commission ${id}: ${res.error.message}`);
    await refetch();
  };

  const handleEditMapping = async (row: MappingRow) => {
    const res = await updateMapping(row);
    if (res.ok) {
      setMappings((prev) =>
        prev.map((r) => (r.entity === row.entity && r.ecosystem === row.ecosystem ? res.data : r)),
      );
    } else {
      setActionError(`Mapping ${row.entity}: ${res.error.message}`);
    }
  };

  return (
    <div className="cog-theme" style={{ padding: "var(--space-5)", maxWidth: 1200 }}>
      {/* Cognitum-branded header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-5)",
        }}
      >
        <div className="cog-brand">
          <span className="cog-hex" aria-hidden>
            ⬢
          </span>
          <div>
            <div className="cog-wordmark">
              Cognitum <span className="cog-accent">Seed</span>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: "2px 0 0" }}>
              ECO-FABRIC · add RuView to Apple Home, Google Home, Alexa &amp; SmartThings
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: wsConnected ? "var(--status-online)" : "var(--status-warning)",
              }}
            />
            {wsConnected ? "Live" : "Polling"}
          </span>
          <button
            type="button"
            onClick={refetch}
            style={{
              padding: "var(--space-2) var(--space-4)",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "rgba(248, 81, 73, 0.1)",
            border: "1px solid rgba(248, 81, 73, 0.3)",
            borderRadius: 6,
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "var(--space-4)",
            fontSize: 13,
            color: "var(--status-error)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {error}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          style={{
            background: "rgba(248, 81, 73, 0.1)",
            border: "1px solid rgba(248, 81, 73, 0.3)",
            borderRadius: 6,
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "var(--space-4)",
            fontSize: 13,
            color: "var(--status-error)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {actionError}
        </div>
      )}

      {isLoading ? (
        <div style={{ color: "var(--text-muted)", padding: "var(--space-5)", textAlign: "center" }}>
          Loading ecosystem status...
        </div>
      ) : (
        <>
          {/* How pairing works — the conceptual frame: RuView is the sensor. */}
          <div className="cog-explainer" style={{ marginBottom: "var(--space-5)" }}>
            <h3>How pairing works</h3>
            <p>
              RuView is the <b>accessory</b> — it appears as a privacy-safe occupancy / motion
              sensor inside your smart-home app. You don't connect RuView to your devices; you{" "}
              <b>add RuView from your ecosystem's app</b>, the same way you'd add a smart plug.
            </p>
            <ol>
              <li>
                Pick an ecosystem below and open <b>How to add</b> for its setup code &amp; steps.
              </li>
              <li>
                In that ecosystem's app (e.g. <b>Apple Home</b>), choose <b>Add device</b> and{" "}
                <b>scan RuView's QR / enter the code</b>.
              </li>
              <li>
                RuView's presence, occupancy &amp; semantic events then show up as sensors you can
                use in automations — at the <b>privacy class</b> you set per ecosystem.
              </li>
            </ol>
          </div>

          {/* 2×2 grid of ecosystem cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "var(--space-4)",
              marginBottom: "var(--space-5)",
            }}
          >
            {status.map((eco) => (
              <EcosystemCard
                key={eco.id}
                ecosystem={eco}
                onPair={handlePair}
                onRepair={handleRepair}
                onCommission={handleCommission}
                matterCode={matterQr?.manual_code ?? null}
                matterQr={matterQr?.qr_payload ?? null}
              />
            ))}
          </div>

          {/* Delivery test */}
          <div style={{ marginBottom: "var(--space-5)" }}>
            <PingAllButton onPing={pingAll} />
          </div>

          {/* Mapping table */}
          <div style={{ marginBottom: "var(--space-5)" }}>
            <EntityMappingTable rows={mappings} editable onEdit={handleEditMapping} />
          </div>

          {/* P4 — longitudinal ecosystem health */}
          <EcosystemHealthPanel report={health} />

          {/* Commissioning log */}
          <MatterCommissioningLog lines={commissioningLog} />
        </>
      )}
    </div>
  );
};

export default Ecosystems;
