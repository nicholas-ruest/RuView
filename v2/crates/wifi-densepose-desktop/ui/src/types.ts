// =============================================================================
// types.ts — TypeScript types matching the Rust domain model for RuView
// =============================================================================

// ---------------------------------------------------------------------------
// Node Discovery & Registry
// ---------------------------------------------------------------------------

export type MacAddress = string; // "AA:BB:CC:DD:EE:FF"

export type HealthStatus = "online" | "offline" | "degraded" | "unknown";

export type DiscoveryMethod = "mdns" | "udp_probe" | "http_sweep" | "manual";

export type MeshRole = "coordinator" | "node" | "aggregator";

export type Chip = "esp32" | "esp32s2" | "esp32s3" | "esp32c3" | "esp32c6";

export interface TdmConfig {
  slot: number;
  total: number;
}

export interface NodeCapabilities {
  wasm: boolean;
  ota: boolean;
  csi: boolean;
}

export interface Node {
  ip: string;
  mac: MacAddress | null;
  hostname: string | null;
  node_id: number;
  firmware_version: string | null;
  tdm_slot: number | null;
  tdm_total: number | null;
  edge_tier: number | null;
  uptime_secs: number | null;
  discovery_method: DiscoveryMethod;
  last_seen: string; // ISO 8601 datetime
  health: HealthStatus;
  chip: Chip;
  mesh_role: MeshRole;
  capabilities: NodeCapabilities | null;
  friendly_name: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Firmware Flashing
// ---------------------------------------------------------------------------

export type FlashPhase =
  | "connecting"
  | "erasing"
  | "writing"
  | "verifying"
  | "done"
  | "error";

export interface FlashProgress {
  phase: FlashPhase;
  progress_pct: number; // 0.0 - 100.0
  bytes_written: number;
  bytes_total: number;
  speed_bps: number;
}

export interface FirmwareBinary {
  path: string;
  filename: string;
  size_bytes: number;
  chip: Chip | null;
}

export interface FlashSession {
  port: string;
  firmware: FirmwareBinary;
  chip: Chip;
  baud: number;
  progress: FlashProgress | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface FlashResult {
  success: boolean;
  duration_ms: number;
  bytes_written: number;
  error: string | null;
}

export interface ChipInfo {
  chip: Chip;
  mac: MacAddress;
  flash_size_bytes: number;
  crystal_freq_mhz: number;
}

// ---------------------------------------------------------------------------
// OTA Updates
// ---------------------------------------------------------------------------

export type OtaStrategy = "sequential" | "tdm_safe" | "parallel";

export type BatchNodeState =
  | "queued"
  | "uploading"
  | "rebooting"
  | "verifying"
  | "done"
  | "failed"
  | "skipped";

export interface OtaSession {
  node_ip: string;
  firmware_path: string;
  progress_pct: number;
  state: BatchNodeState;
  error: string | null;
}

export interface BatchOtaSession {
  strategy: OtaStrategy;
  max_concurrent: number;
  batch_delay_secs: number;
  fail_fast: boolean;
  nodes: OtaSession[];
  started_at: string | null;
  finished_at: string | null;
}

export interface OtaResult {
  node_ip: string;
  success: boolean;
  previous_version: string | null;
  new_version: string | null;
  duration_ms: number;
  error: string | null;
}

export interface OtaStatus {
  current_version: string;
  partition: string;
  update_available: boolean;
}

// ---------------------------------------------------------------------------
// WASM Modules
// ---------------------------------------------------------------------------

export type WasmModuleState = "running" | "stopped" | "error" | "loading";

export interface WasmModule {
  module_id: string;
  name: string;
  size_bytes: number;
  state: WasmModuleState;
  node_ip: string;
  loaded_at: string | null;
  error: string | null;
  memory_used_kb: number | null;
  cpu_usage_pct: number | null;
  exec_count: number | null;
}

// ---------------------------------------------------------------------------
// Sensing Server
// ---------------------------------------------------------------------------

export type DataSource = "auto" | "wifi" | "esp32" | "simulate";

export interface ServerConfig {
  http_port: number;
  ws_port: number;
  udp_port: number;
  static_dir: string | null;
  model_dir: string | null;
  log_level: string;
  source: DataSource;
}

export interface ServerStatus {
  running: boolean;
  pid: number | null;
  http_port: number | null;
  ws_port: number | null;
  udp_port: number | null;
  uptime_secs: number | null;
  error: string | null;
}

export interface SensingUpdate {
  timestamp: string;
  node_id: number;
  subcarrier_count: number;
  rssi: number;
  activity: string | null;
  confidence: number | null;
}

// ---------------------------------------------------------------------------
// Serial Port
// ---------------------------------------------------------------------------

export interface SerialPort {
  name: string;          // e.g. "COM3" or "/dev/ttyUSB0"
  description: string;   // e.g. "Silicon Labs CP210x"
  chip: Chip | null;     // detected chip type, if any
  manufacturer: string | null;
  vid: number | null;    // USB vendor ID
  pid: number | null;    // USB product ID
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  server_http_port: number;
  server_ws_port: number;
  server_udp_port: number;
  bind_address: string;
  ui_path: string;
  ota_psk: string;
  auto_discover: boolean;
  discover_interval_ms: number;
  theme: "dark" | "light";
}

// ---------------------------------------------------------------------------
// Smart Home Ecosystems — ECO-FABRIC (ADR-172)
// ---------------------------------------------------------------------------

/** The four supported consumer ecosystems. Matches `id` in GET /status. */
export type EcosystemId =
  | "apple_home"
  | "google_home"
  | "amazon_alexa"
  | "smartthings";

/** Per-ecosystem pairing state (ADR-172 §2.3). */
export type PairingState = "paired" | "unpaired" | "error";

/** Per-ecosystem health indicator (ADR-172 §2.3). */
export type EcoHealth = "ok" | "degraded" | "down";

/**
 * Effective privacy class for a networked ecosystem (ADR-172 §2.5).
 * Only class 2 ("Anonymous") and class 3 ("Restricted") are permitted at the
 * four-ecosystem boundary; the API rejects anything below 2 with 422.
 */
export type PrivacyClass = 2 | 3;

/** One ecosystem's status row from GET /api/v1/ecosystems/status. */
export interface EcosystemStatus {
  id: EcosystemId;
  protocol: string; // "hap-1.1" | "matter-1.4"
  pairing: PairingState;
  health: EcoHealth;
  /** Is the live path's feature flag (hap-server / Matter SDK) compiled in? */
  feature_available: boolean;
  privacy_class: PrivacyClass;
  /** Ecosystem-specific identifiers (mdns_advertised, fabric_id, device_id, ...). */
  details: Record<string, unknown>;
}

/** Snapshot of all four ecosystems. */
export interface EcosystemsStatus {
  ecosystems: EcosystemStatus[];
}

/** GET /api/v1/ecosystems/matter/qr response. */
export interface MatterQr {
  /** "MT:"-prefixed payload, or null until QR generation lands (v0.7.1). */
  qr_payload: string | null;
  /** Real today — 11-digit manual code from commissioning.rs. */
  manual_code: string;
  discriminator: number;
  vendor_id: number;
  product_id: number;
}

/** One row of the entity → primitive mapping table (per ecosystem). */
export interface MappingRow {
  /** RuView source entity, e.g. "presence", "identity_risk_score". */
  entity: string;
  /** Target ecosystem this mapping applies to. */
  ecosystem: EcosystemId;
  /** Target primitive, e.g. "MotionSensor → MotionDetected". */
  primitive: string;
  /** Internal-only rows (identity_risk_score) are read-only / greyed. */
  internal_only: boolean;
}

/** One result row from POST /ping-all. */
export interface PingResult {
  ecosystem: EcosystemId;
  delivered: boolean;
  latency_ms?: number;
  reason?: string;
}

// P4 — longitudinal ecosystem health (ADR-172).
export interface HealthSample {
  t_ms: number;
  delivered: boolean;
  latency_ms?: number;
}

export interface EcoHealthSeries {
  ecosystem: EcosystemId;
  samples: HealthSample[];
  delivered: number;
  total: number;
  error_rate: number;
  avg_latency_ms?: number;
  recommission_alerts: number;
}

export interface HealthReport {
  window_hours: number;
  ecosystems: EcoHealthSeries[];
}
