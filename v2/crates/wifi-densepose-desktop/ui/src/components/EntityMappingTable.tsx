import { useState } from "react";
import type { EcosystemId, MappingRow } from "../types";

interface EntityMappingTableProps {
  rows: MappingRow[];
  editable?: boolean;
  /** Persist an edited row (PUT /mappings). */
  onEdit?: (row: MappingRow) => Promise<void> | void;
}

const ECO_LABEL: Record<EcosystemId, string> = {
  apple_home: "Apple Home",
  google_home: "Google Home",
  amazon_alexa: "Amazon Alexa",
  smartthings: "SmartThings",
};

function rowKey(row: MappingRow): string {
  return `${row.ecosystem}:${row.entity}`;
}

/**
 * Editable per-ecosystem entity → primitive mapping (ADR-172 §2.6). Internal-only
 * rows (e.g. identity_risk_score) are rendered read-only and greyed — those
 * fields never cross the HAP/Matter boundary (ADR-125 §2.1.d).
 */
export function EntityMappingTable({ rows, editable = true, onEdit }: EntityMappingTableProps) {
  // Per-row draft + dirty tracking.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const draftFor = (row: MappingRow): string =>
    drafts[rowKey(row)] ?? row.primitive;

  const isDirty = (row: MappingRow): boolean => {
    const key = rowKey(row);
    return key in drafts && drafts[key] !== row.primitive;
  };

  const setDraft = (row: MappingRow, value: string) => {
    setDrafts((prev) => ({ ...prev, [rowKey(row)]: value }));
  };

  const save = async (row: MappingRow) => {
    const key = rowKey(row);
    setSavingKey(key);
    try {
      await onEdit?.({ ...row, primitive: draftFor(row) });
      // Clear the draft so the row reflects the committed value.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } finally {
      setSavingKey(null);
    }
  };

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
        Entity Mapping
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={thStyle}>RuView Entity</th>
            <th style={thStyle}>Ecosystem</th>
            <th style={thStyle}>Primitive</th>
            {editable && <th style={thStyle} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={editable ? 4 : 3} style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted)" }}>
                No mappings.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const readonly = row.internal_only || !editable;
              const dirty = isDirty(row);
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  style={{
                    opacity: row.internal_only ? 0.5 : 1,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {row.entity}
                    {row.internal_only && (
                      <span
                        title="Internal-only — never crosses the ecosystem boundary"
                        style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}
                      >
                        (internal)
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>
                    {ECO_LABEL[row.ecosystem]}
                  </td>
                  <td style={tdStyle}>
                    {readonly ? (
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                        {row.primitive || "—"}
                      </span>
                    ) : (
                      <input
                        type="text"
                        aria-label={`${row.entity} primitive for ${ECO_LABEL[row.ecosystem]}`}
                        value={draftFor(row)}
                        onChange={(e) => setDraft(row, e.target.value)}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 12, width: "100%" }}
                      />
                    )}
                  </td>
                  {editable && (
                    <td style={{ ...tdStyle, width: 72, textAlign: "right" }}>
                      {!readonly && dirty && (
                        <button
                          type="button"
                          onClick={() => save(row)}
                          disabled={savingKey === key}
                          style={{
                            padding: "2px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 4,
                            border: "none",
                            background: "var(--accent)",
                            color: "var(--accent-contrast, #fff)",
                            cursor: savingKey === key ? "not-allowed" : "pointer",
                            opacity: savingKey === key ? 0.6 : 1,
                          }}
                        >
                          {savingKey === key ? "..." : "Save"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  verticalAlign: "middle",
};
