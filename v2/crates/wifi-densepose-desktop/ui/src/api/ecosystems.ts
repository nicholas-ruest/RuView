// =============================================================================
// api/ecosystems.ts — fetch-based client for the ECO-FABRIC HOMECORE-API
// (ADR-172 §2.3). REST under /api/v1/ecosystems/, every route behind the
// ADR-161 BearerAuth token whitelist. NOT Tauri invoke — the ADR specifies REST.
// =============================================================================

import type {
  EcosystemId,
  EcosystemsStatus,
  MappingRow,
  MatterQr,
  PrivacyClass,
} from "../types";

// ---------------------------------------------------------------------------
// Runtime config: base URL + bearer token
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://127.0.0.1:8123";

interface EcosystemsConfig {
  baseUrl: string;
  token: string;
}

function envString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

// Read defaults from Vite env at module load; allow a runtime override below.
const config: EcosystemsConfig = {
  baseUrl: envString(import.meta.env?.VITE_HOMECORE_URL, DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  ),
  token: envString(import.meta.env?.VITE_HOMECORE_TOKEN, ""),
};

/** Override the HOMECORE base URL and/or bearer token at runtime. */
export function configureEcosystems(next: Partial<EcosystemsConfig>): void {
  if (next.baseUrl !== undefined) config.baseUrl = next.baseUrl.replace(/\/+$/, "");
  if (next.token !== undefined) config.token = next.token;
}

/** Current effective config (for the hook to build the WS URL + auth token). */
export function getEcosystemsConfig(): Readonly<EcosystemsConfig> {
  return { ...config };
}

// ---------------------------------------------------------------------------
// Typed result envelope — 409 / 422 error bodies are returned, never thrown.
// ---------------------------------------------------------------------------

/** A typed API error body, e.g. { error, message }. */
export interface ApiError {
  /** Machine-readable code, e.g. "hap_server_disabled", "class_below_floor". */
  error: string;
  /** Human-readable message. */
  message: string;
  /** HTTP status that produced this error. */
  status: number;
}

/** Discriminated result: either ok data, or a typed error. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(error: ApiError): ApiResult<T> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

const BASE_PATH = "/api/v1/ecosystems";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = "GET", body } = opts;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${BASE_PATH}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Network / CORS / connection failure — surface as a typed error.
    return fail<T>({
      error: "network_error",
      message: err instanceof Error ? err.message : String(err),
      status: 0,
    });
  }

  // Parse the body once (may be empty).
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (res.ok) {
    return ok<T>(parsed as T);
  }

  // Map the 401 / 409 / 422 (and any non-2xx) error body to a typed ApiError.
  const errBody = (parsed ?? {}) as Partial<ApiError>;
  return fail<T>({
    error: envString(errBody.error, `http_${res.status}`),
    message: envString(errBody.message, res.statusText || `HTTP ${res.status}`),
    status: res.status,
  });
}

// ---------------------------------------------------------------------------
// Typed endpoint functions (ADR-172 §2.3)
// ---------------------------------------------------------------------------

export function getStatus(): Promise<ApiResult<EcosystemsStatus>> {
  return request<EcosystemsStatus>("/status");
}

export function getMatterQr(): Promise<ApiResult<MatterQr>> {
  return request<MatterQr>("/matter/qr");
}

export interface ApplePairResult {
  mdns_advertised: boolean;
  setup_pin: string;
  qr_uri: string;
}

export function pairApple(): Promise<ApiResult<ApplePairResult>> {
  return request<ApplePairResult>("/apple/pair", { method: "POST" });
}

export function repairApple(): Promise<ApiResult<ApplePairResult>> {
  return request<ApplePairResult>("/apple/repair", { method: "POST" });
}

export interface CommissionResult {
  fabric_id: string;
  node_id: string;
  status: string;
}

export function commissionMatter(
  ecosystem: EcosystemId,
): Promise<ApiResult<CommissionResult>> {
  return request<CommissionResult>("/matter/commission", {
    method: "POST",
    body: { ecosystem },
  });
}

export function getMappings(): Promise<ApiResult<MappingRow[]>> {
  return request<MappingRow[]>("/mappings");
}

export function updateMapping(row: MappingRow): Promise<ApiResult<MappingRow>> {
  return request<MappingRow>("/mappings", { method: "PUT", body: row });
}

export interface PrivacyResult {
  ecosystem: EcosystemId;
  privacy_class: PrivacyClass;
  applied: boolean;
}

export function setPrivacy(
  ecosystem: EcosystemId,
  privacyClass: PrivacyClass,
): Promise<ApiResult<PrivacyResult>> {
  return request<PrivacyResult>(`/${ecosystem}/privacy`, {
    method: "PUT",
    body: { privacy_class: privacyClass },
  });
}

export interface PingAllResponse {
  results: import("../types").PingResult[];
}

export function pingAll(): Promise<ApiResult<PingAllResponse>> {
  return request<PingAllResponse>("/ping-all", { method: "POST" });
}

// P4 — longitudinal ecosystem health (ADR-172).
export function getHealth(
  windowHours = 24,
): Promise<ApiResult<import("../types").HealthReport>> {
  return request<import("../types").HealthReport>(`/health?window_hours=${windowHours}`);
}
