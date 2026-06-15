import { useEffect, useState } from "react";
import type { EcosystemId, MappingRow, MatterQr } from "../types";
import { useEcosystems } from "../hooks/useEcosystems";
import { EcosystemCard } from "../components/EcosystemCard";
import { PingAllButton } from "../components/PingAllButton";
import { EntityMappingTable } from "../components/EntityMappingTable";
import { PairingQRCode } from "../components/PairingQRCode";
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
    <div style={{ padding: "var(--space-5)", maxWidth: 1200 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-5)",
        }}
      >
        <div>
          <h1 className="heading-lg" style={{ margin: 0 }}>
            Ecosystems
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: "var(--space-1)" }}>
            ECO-FABRIC — one control surface for Apple Home, Google Home, Alexa, and SmartThings
          </p>
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
              />
            ))}
          </div>

          {/* Ping-all + Matter pairing artifacts */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: "var(--space-4)",
              marginBottom: "var(--space-5)",
            }}
          >
            <PingAllButton onPing={pingAll} />
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "var(--space-4)",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <PairingQRCode
                kind="matter"
                payload={matterQr?.qr_payload ?? null}
                manualCode={matterQr?.manual_code}
              />
            </div>
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
