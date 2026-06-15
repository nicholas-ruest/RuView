import { useState } from "react";
import type { EcosystemId, PrivacyClass } from "../types";
import { setPrivacy } from "../api/ecosystems";

interface PrivacyClassToggleProps {
  ecosystem: EcosystemId;
  value: PrivacyClass;
  /** Called with the new class once the API confirms it applied. */
  onChange?: (next: PrivacyClass) => void;
}

const OPTIONS: { value: PrivacyClass; label: string }[] = [
  { value: 2, label: "Anonymous" },
  { value: 3, label: "Restricted" },
];

/**
 * Anonymous | Restricted segmented control (ADR-172 §2.5). PUTs on change and
 * surfaces the 422 `class_below_floor` error inline if the API rejects it.
 * The fail-closed floor means only class 2 / 3 are offered at this boundary.
 */
export function PrivacyClassToggle({ ecosystem, value, onChange }: PrivacyClassToggleProps) {
  const [pending, setPending] = useState<PrivacyClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  const select = async (next: PrivacyClass) => {
    if (next === value || pending != null) return;
    setError(null);
    setPending(next);
    try {
      const res = await setPrivacy(ecosystem, next);
      if (res.ok && res.data.applied) {
        onChange?.(res.data.privacy_class);
      } else if (!res.ok) {
        setError(res.error.message);
      } else {
        setError("Privacy class change was not applied.");
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      <div
        role="group"
        aria-label="Privacy class"
        style={{
          display: "inline-flex",
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {OPTIONS.map((opt) => {
          const active = opt.value === value;
          const busy = pending === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => select(opt.value)}
              disabled={pending != null}
              aria-pressed={active}
              title={`Class ${opt.value} — ${opt.label}`}
              style={{
                padding: "var(--space-1) var(--space-3)",
                fontSize: 11,
                fontWeight: 600,
                border: "none",
                cursor: pending != null ? "not-allowed" : "pointer",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "#fff" : "var(--text-secondary)",
                opacity: busy ? 0.6 : 1,
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {busy ? "..." : opt.label}
            </button>
          );
        })}
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--status-error)",
            fontFamily: "var(--font-mono)",
            maxWidth: 220,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
