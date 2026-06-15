import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface PairingQRCodeProps {
  kind: "hap" | "matter";
  /** QR string. May be null (Matter QR generation lands in v0.7.1). */
  payload: string | null;
  /** Manual pairing code fallback (Matter 11-digit). */
  manualCode?: string;
  /** Setup PIN fallback (HAP, formatted XXX-XX-XXX). */
  pin?: string;
}

/**
 * Renders the pairing QR as a data-URL <img> when a payload is present
 * (uses the `qrcode` npm package), otherwise shows the manual code / PIN
 * prominently with a note (ADR-172 §2.6). Matter QR is null until v0.7.1, so
 * the manual code path is the common case today.
 */
export function PairingQRCode({ kind, payload, manualCode, pin }: PairingQRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(payload, { margin: 1, width: 160 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const fallback = kind === "hap" ? pin : manualCode;
  const fallbackLabel = kind === "hap" ? "Setup PIN" : "Manual pairing code";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
      }}
    >
      {payload && dataUrl ? (
        <img
          src={dataUrl}
          alt={`${kind} pairing QR code`}
          width={160}
          height={160}
          style={{ borderRadius: 8, background: "#fff", padding: 8 }}
        />
      ) : (
        <div
          style={{
            width: 160,
            height: 160,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            color: "var(--text-muted)",
            fontSize: 11,
            textAlign: "center",
            padding: "var(--space-3)",
          }}
        >
          QR code unavailable
          <span style={{ marginTop: 4 }}>(v0.7.1)</span>
        </div>
      )}

      {fallback && (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
            }}
          >
            {fallbackLabel}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "0.02em",
            }}
          >
            {fallback}
          </div>
        </div>
      )}

      {!payload && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", maxWidth: 200 }}>
          Enter the {fallbackLabel.toLowerCase()} manually in the vendor app.
        </div>
      )}
    </div>
  );
}
