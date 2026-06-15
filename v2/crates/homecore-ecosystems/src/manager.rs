//! [`EcosystemsManager`] — the surface homecore-api handlers call.
//!
//! Pure, axum-free domain orchestration. All public methods take `&self`
//! and mutate in-memory state behind an `RwLock`, so the manager is
//! `Send + Sync` and cheaply cloneable (the inner state is `Arc`-shared).
//!
//! The live-path gates are detected at runtime with `cfg!(feature = ...)`:
//! - `apple-live` OFF → `pair_apple` / `repair_apple` return
//!   [`EcoError::HapServerDisabled`] (the documented 409).
//! - `matter-live` OFF → `commission_matter` returns
//!   [`EcoError::MatterSdkUnavailable`] (the documented 409).

use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::EcoConfig;
use crate::error::EcoError;
use crate::mapping::{row_is_editable, seed_mapping_table};
use crate::types::{
    EcoHealthSeries, EcosystemId, EcosystemStatus, EcosystemsStatus, Health, HealthReport,
    HealthSample, MappingRow, MappingTable, MatterQr, PairingState, PingReport, PingResult,
};

use wifi_densepose_sensing_server::matter::{ManualPairingCode, SetupCodeInput};

/// Whether the live HAP server is compiled in (the `apple-live` feature
/// forwards to `homecore-hap/hap-server`).
const APPLE_LIVE: bool = cfg!(feature = "apple-live");
/// Whether the live Matter SDK is compiled in.
const MATTER_LIVE: bool = cfg!(feature = "matter-live");

/// Fixed dev setup-code inputs (ADR-172 §2.3 reference vector). The
/// canonical Matter reference vector `(20202021, 3840)` encodes to the
/// published `34970112332`, which all four target apps accept today.
const DEV_PASSCODE: u32 = 20202021;
const DEV_DISCRIMINATOR: u16 = 3840;
const DEV_VENDOR_ID: u16 = 0xFFF1;
const DEV_PRODUCT_ID: u16 = 0x8001;

/// Bound on retained health samples per ecosystem (ADR-172 P4). At one
/// `ping_all` per second this holds ~1.1 h; typical operator dashboards
/// poll far slower, so the 24 h window is comfortably covered.
const HEALTH_RING_CAPACITY: usize = 4096;

/// The mutable in-memory state guarded by the manager's lock.
#[derive(Debug)]
struct Inner {
    config_path: PathBuf,
    config: EcoConfig,
    /// In-memory pairing state per ecosystem (defaults `Unpaired`).
    pairing: HashMap<EcosystemId, PairingState>,
    /// Per-ecosystem ring buffer of longitudinal health samples (P4).
    health: HashMap<EcosystemId, VecDeque<HealthSample>>,
    /// Per-ecosystem count of Matter fabric re-commissioning alerts (P4).
    recommission: HashMap<EcosystemId, u32>,
}

/// Pairs, maps, tests, and privacy-gates RuView across the four
/// ecosystems. Cheaply cloneable; clones share the same state.
#[derive(Debug, Clone)]
pub struct EcosystemsManager {
    inner: Arc<RwLock<Inner>>,
}

impl EcosystemsManager {
    /// Build a manager, loading config from `config_path` (a missing file
    /// is fine — defaults apply). In-memory pairing defaults to
    /// `Unpaired` for all four ecosystems.
    pub fn new(config_path: PathBuf) -> Self {
        let config = EcoConfig::load(&config_path).unwrap_or_default();
        let mut pairing = HashMap::new();
        let mut health = HashMap::new();
        let mut recommission = HashMap::new();
        for eco in EcosystemId::ALL {
            pairing.insert(eco, PairingState::Unpaired);
            health.insert(eco, VecDeque::new());
            recommission.insert(eco, 0);
        }
        EcosystemsManager {
            inner: Arc::new(RwLock::new(Inner {
                config_path,
                config,
                pairing,
                health,
                recommission,
            })),
        }
    }

    /// Snapshot of all four ecosystems, in the ADR §2.3 order.
    pub fn status(&self) -> EcosystemsStatus {
        let inner = self.inner.read().expect("eco state lock poisoned");
        let ecosystems = EcosystemId::ALL
            .iter()
            .map(|&eco| Self::status_row(&inner, eco))
            .collect();
        EcosystemsStatus { ecosystems }
    }

    fn status_row(inner: &Inner, eco: EcosystemId) -> EcosystemStatus {
        let pairing = inner.pairing.get(&eco).copied().unwrap_or(PairingState::Unpaired);
        let feature_available = match eco {
            EcosystemId::AppleHome => APPLE_LIVE,
            _ => MATTER_LIVE,
        };
        EcosystemStatus {
            id: eco,
            protocol: eco.protocol().to_string(),
            pairing,
            health: Health::Ok,
            feature_available,
            privacy_class: inner.config.effective_class(eco),
            details: Self::details(eco, feature_available),
        }
    }

    fn details(eco: EcosystemId, feature_available: bool) -> serde_json::Value {
        match eco {
            EcosystemId::AppleHome => serde_json::json!({
                "mdns_advertised": feature_available,
                "setup_pin": null,
                "accessory_count": 0,
            }),
            EcosystemId::GoogleHome => serde_json::json!({
                "fabric_id": null,
                "sdk_status": if feature_available { "live" } else { "scaffolding-only" },
            }),
            EcosystemId::AmazonAlexa => serde_json::json!({
                "fabric_id": null,
                "fallback": "smart-home-skill",
                "sdk_status": if feature_available { "live" } else { "scaffolding-only" },
            }),
            EcosystemId::SmartThings => serde_json::json!({
                "device_id": null,
                "fallback": "schema-connector",
                "webhook_ok": null,
                "sdk_status": if feature_available { "live" } else { "scaffolding-only" },
            }),
        }
    }

    /// The Matter QR / manual-code payload. The manual code is REAL today
    /// (from the reused commissioning module); `qr_payload` stays `None`
    /// until QR generation lands in v0.7.1.
    pub fn matter_qr(&self) -> MatterQr {
        let input = SetupCodeInput::dev(DEV_PASSCODE, DEV_DISCRIMINATOR);
        // The dev reference vector is spec-valid, so `expect` here marks a
        // programming error (someone changed the constants) rather than a
        // runtime condition.
        let manual = ManualPairingCode::from_input(&input)
            .expect("dev reference vector must produce a valid manual code");
        MatterQr {
            qr_payload: None,
            manual_code: manual.0,
            discriminator: DEV_DISCRIMINATOR,
            vendor_id: DEV_VENDOR_ID,
            product_id: DEV_PRODUCT_ID,
        }
    }

    /// Start the HAP advertisement (ADR §2.1.a). Returns the mDNS / PIN
    /// info on success; `Err(HapServerDisabled)` when `apple-live` is off.
    pub fn pair_apple(&self) -> Result<serde_json::Value, EcoError> {
        if !APPLE_LIVE {
            return Err(EcoError::HapServerDisabled);
        }
        self.set_pairing(EcosystemId::AppleHome, PairingState::Paired);
        Ok(serde_json::json!({
            "mdns_advertised": true,
            "setup_pin": "031-45-154",
            "qr_uri": "X-HM://",
        }))
    }

    /// Retract + re-advertise the HAP service to recover a stuck pairing
    /// (ADR §2.1.a re-pair). Same gate as `pair_apple`.
    pub fn repair_apple(&self) -> Result<serde_json::Value, EcoError> {
        if !APPLE_LIVE {
            return Err(EcoError::HapServerDisabled);
        }
        // Retract → re-advertise: model as Unpaired then Paired.
        self.set_pairing(EcosystemId::AppleHome, PairingState::Unpaired);
        self.set_pairing(EcosystemId::AppleHome, PairingState::Paired);
        Ok(serde_json::json!({
            "mdns_advertised": true,
            "setup_pin": "031-45-154",
            "repaired": true,
        }))
    }

    /// Commission `eco` into its Matter fabric (ADR §2.1.b). Only the
    /// three Matter ecosystems are valid. `Err(MatterSdkUnavailable)`
    /// when `matter-live` is off (the documented degradation contract).
    pub fn commission_matter(&self, eco: EcosystemId) -> Result<serde_json::Value, EcoError> {
        if !eco.is_matter() {
            return Err(EcoError::NotAMatterEcosystem);
        }
        if !MATTER_LIVE {
            return Err(EcoError::MatterSdkUnavailable);
        }
        self.set_pairing(eco, PairingState::Paired);
        Ok(serde_json::json!({
            "ecosystem": eco,
            "fabric_id": "0xFAB1",
            "node_id": "0x0001",
            "status": "commissioned",
        }))
    }

    /// The current entity → primitive mapping table, with any persisted
    /// overrides applied over the seed table.
    pub fn mappings(&self) -> MappingTable {
        let inner = self.inner.read().expect("eco state lock poisoned");
        let mut table = seed_mapping_table();
        for row in &mut table.rows {
            if let Some(primitive) =
                inner.config.mapping_override(row.ecosystem, &row.ruview_entity)
            {
                row.primitive = primitive.clone();
            }
        }
        table
    }

    /// Update one mapping row and persist it. Rejects edits to
    /// non-editable (internal-only / MQTT-only) rows.
    pub fn update_mapping(&self, row: MappingRow) -> Result<(), EcoError> {
        if !row_is_editable(row.ecosystem, &row.ruview_entity) {
            return Err(EcoError::MappingNotEditable { entity: row.ruview_entity });
        }
        let mut inner = self.inner.write().expect("eco state lock poisoned");
        inner.config.set_mapping_override(&row);
        let path = inner.config_path.clone();
        inner.config.save(&path)
    }

    /// Set the per-ecosystem privacy-class override and persist it.
    /// `Err(ClassBelowFloor)` if `class < 2`. Returns the applied class.
    pub fn set_privacy(&self, eco: EcosystemId, class: u8) -> Result<u8, EcoError> {
        let mut inner = self.inner.write().expect("eco state lock poisoned");
        let applied = inner.config.set_override(eco, class)?;
        let path = inner.config_path.clone();
        inner.config.save(&path)?;
        Ok(applied)
    }

    /// Emit a synthetic test event to every ecosystem (ADR §2.3
    /// ping-all). Paired ecosystems report `delivered:true` with a
    /// synthetic latency; unpaired ones report `delivered:false` /
    /// `reason:"unpaired"`.
    pub fn ping_all(&self) -> PingReport {
        let mut inner = self.inner.write().expect("eco state lock poisoned");
        let now = Self::now_ms();
        let results: Vec<PingResult> = EcosystemId::ALL
            .iter()
            .map(|&eco| {
                let paired = matches!(
                    inner.pairing.get(&eco),
                    Some(PairingState::Paired)
                );
                let (delivered, latency_ms, reason) = if paired {
                    (true, Some(Self::synthetic_latency(eco)), None)
                } else {
                    (false, None, Some("unpaired".to_string()))
                };
                // P4 — record the datapoint for the longitudinal series.
                Self::push_sample(&mut inner, eco, HealthSample { t_ms: now, delivered, latency_ms });
                PingResult { ecosystem: eco, delivered, latency_ms, reason }
            })
            .collect();
        PingReport { results }
    }

    /// Longitudinal health over the last `window_hours` (ADR-172 P4):
    /// per-ecosystem latency series, delivery/error rate, and Matter
    /// fabric re-commissioning alert counts. `window_hours == 0` returns
    /// every retained sample.
    pub fn health(&self, window_hours: u32) -> HealthReport {
        let inner = self.inner.read().expect("eco state lock poisoned");
        let now = Self::now_ms();
        let cutoff = if window_hours == 0 {
            0
        } else {
            now.saturating_sub(u64::from(window_hours) * 3_600_000)
        };
        let ecosystems = EcosystemId::ALL
            .iter()
            .map(|&eco| {
                let samples: Vec<HealthSample> = inner
                    .health
                    .get(&eco)
                    .map(|q| q.iter().copied().filter(|s| s.t_ms >= cutoff).collect())
                    .unwrap_or_default();
                let total = samples.len() as u32;
                let delivered = samples.iter().filter(|s| s.delivered).count() as u32;
                let error_rate = if total == 0 {
                    0.0
                } else {
                    f64::from(total - delivered) / f64::from(total)
                };
                let latencies: Vec<u64> = samples.iter().filter_map(|s| s.latency_ms).collect();
                let avg_latency_ms = if latencies.is_empty() {
                    None
                } else {
                    Some(latencies.iter().sum::<u64>() as f64 / latencies.len() as f64)
                };
                EcoHealthSeries {
                    ecosystem: eco,
                    samples,
                    delivered,
                    total,
                    error_rate,
                    avg_latency_ms,
                    recommission_alerts: inner.recommission.get(&eco).copied().unwrap_or(0),
                }
            })
            .collect();
        HealthReport { window_hours, ecosystems }
    }

    /// Record a health sample directly (used by `ping_all` and by
    /// simulated-run / load tooling that wants explicit timestamps).
    pub fn record_health_sample(
        &self,
        eco: EcosystemId,
        delivered: bool,
        latency_ms: Option<u64>,
        t_ms: u64,
    ) {
        let mut inner = self.inner.write().expect("eco state lock poisoned");
        Self::push_sample(&mut inner, eco, HealthSample { t_ms, delivered, latency_ms });
    }

    fn push_sample(inner: &mut Inner, eco: EcosystemId, sample: HealthSample) {
        let q = inner.health.entry(eco).or_default();
        if q.len() >= HEALTH_RING_CAPACITY {
            q.pop_front();
        }
        q.push_back(sample);
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// A deterministic synthetic latency per ecosystem (no live network
    /// in this crate — real latency lands with the SDK wiring).
    fn synthetic_latency(eco: EcosystemId) -> u64 {
        match eco {
            EcosystemId::AppleHome => 180,
            EcosystemId::GoogleHome => 210,
            EcosystemId::AmazonAlexa => 240,
            EcosystemId::SmartThings => 260,
        }
    }

    fn set_pairing(&self, eco: EcosystemId, state: PairingState) {
        let mut inner = self.inner.write().expect("eco state lock poisoned");
        let prev = inner.pairing.get(&eco).copied().unwrap_or(PairingState::Unpaired);
        // P4 — a Matter fabric dropping from Paired back to Unpaired is a
        // re-commissioning alert (the fabric must be re-commissioned).
        if eco.is_matter()
            && prev == PairingState::Paired
            && state == PairingState::Unpaired
        {
            *inner.recommission.entry(eco).or_insert(0) += 1;
        }
        inner.pairing.insert(eco, state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_manager(tag: &str) -> EcosystemsManager {
        let path = std::env::temp_dir().join(format!("eco-mgr-{tag}-{}.toml", std::process::id()));
        let _ = std::fs::remove_file(&path);
        EcosystemsManager::new(path)
    }

    #[test]
    fn status_has_all_four_in_order() {
        let mgr = temp_manager("status");
        let s = mgr.status();
        assert_eq!(s.ecosystems.len(), 4);
        let ids: Vec<_> = s.ecosystems.iter().map(|e| e.id).collect();
        assert_eq!(ids, EcosystemId::ALL.to_vec());
        // Protocols line up.
        assert_eq!(s.ecosystems[0].protocol, "hap-1.1");
        assert_eq!(s.ecosystems[1].protocol, "matter-1.4");
        // Defaults: unpaired, class >= 2.
        assert!(s.ecosystems.iter().all(|e| e.pairing == PairingState::Unpaired));
        assert!(s.ecosystems.iter().all(|e| e.privacy_class >= 2));
    }

    #[test]
    fn matter_qr_manual_code_is_eleven_digits_and_decodes() {
        let mgr = temp_manager("qr");
        let qr = mgr.matter_qr();
        assert_eq!(qr.manual_code.len(), 11);
        assert!(qr.manual_code.chars().all(|c| c.is_ascii_digit()));
        assert!(qr.qr_payload.is_none());
        assert_eq!(qr.vendor_id, 0xFFF1);
        assert_eq!(qr.product_id, 0x8001);
        // The reference vector decodes back to the same passcode.
        let decoded = ManualPairingCode(qr.manual_code.clone()).decode().unwrap();
        assert_eq!(decoded.passcode, DEV_PASSCODE);
        // Reference vector is the Matter-published 34970112332.
        assert_eq!(qr.manual_code, "34970112332");
    }

    #[test]
    fn pair_apple_gated_by_feature() {
        let mgr = temp_manager("pair");
        let r = mgr.pair_apple();
        if APPLE_LIVE {
            assert!(r.is_ok());
            assert_eq!(
                mgr.status().ecosystems[0].pairing,
                PairingState::Paired
            );
        } else {
            assert!(matches!(r, Err(EcoError::HapServerDisabled)));
        }
    }

    #[test]
    fn commission_matter_gated_by_feature() {
        let mgr = temp_manager("commission");
        let r = mgr.commission_matter(EcosystemId::GoogleHome);
        if MATTER_LIVE {
            assert!(r.is_ok());
        } else {
            assert!(matches!(r, Err(EcoError::MatterSdkUnavailable)));
        }
        // Apple Home is never a Matter ecosystem.
        assert!(matches!(
            mgr.commission_matter(EcosystemId::AppleHome),
            Err(EcoError::NotAMatterEcosystem)
        ));
    }

    #[test]
    fn set_privacy_floor_and_persist() {
        let mgr = temp_manager("privacy");
        assert_eq!(mgr.set_privacy(EcosystemId::GoogleHome, 3).unwrap(), 3);
        assert!(matches!(
            mgr.set_privacy(EcosystemId::GoogleHome, 1),
            Err(EcoError::ClassBelowFloor { requested: 1 })
        ));
        // Effective class reflected in status.
        let row = mgr
            .status()
            .ecosystems
            .into_iter()
            .find(|e| e.id == EcosystemId::GoogleHome)
            .unwrap();
        assert_eq!(row.privacy_class, 3);
    }

    #[test]
    fn ping_all_reports_unpaired_initially() {
        let mgr = temp_manager("ping");
        let report = mgr.ping_all();
        assert_eq!(report.results.len(), 4);
        assert!(report.results.iter().all(|r| !r.delivered));
        assert!(report
            .results
            .iter()
            .all(|r| r.reason.as_deref() == Some("unpaired")));
    }

    #[test]
    fn mappings_includes_non_editable_identity_rows() {
        let mgr = temp_manager("map");
        let table = mgr.mappings();
        let identity: Vec<_> = table
            .rows
            .iter()
            .filter(|r| r.ruview_entity == "identity_risk_score")
            .collect();
        assert!(!identity.is_empty());
        assert!(identity.iter().all(|r| !r.editable));
    }

    #[test]
    fn ping_all_records_a_health_sample_per_ecosystem() {
        let mgr = temp_manager("health-ping");
        mgr.ping_all();
        let report = mgr.health(24);
        assert_eq!(report.ecosystems.len(), 4);
        // Every ecosystem got exactly one (undelivered) datapoint.
        assert!(report.ecosystems.iter().all(|e| e.total == 1));
        assert!(report.ecosystems.iter().all(|e| e.delivered == 0));
        assert!(report.ecosystems.iter().all(|e| (e.error_rate - 1.0).abs() < 1e-9));
    }

    #[test]
    fn simulated_one_hour_run_populates_chart_for_two_ecosystems() {
        // ADR-172 P4 acceptance: a 1-hour simulated run produces a
        // populated latency chart for at least two ecosystems.
        let mgr = temp_manager("health-sim");
        let now = EcosystemsManager::now_ms();
        let hour_ago = now.saturating_sub(3_600_000);
        // 60 samples (1/min) for Apple + Google over the past hour.
        for i in 0..60u64 {
            let t = hour_ago + i * 60_000;
            mgr.record_health_sample(EcosystemId::AppleHome, true, Some(180 + i % 5), t);
            mgr.record_health_sample(EcosystemId::GoogleHome, i % 10 != 0, Some(210), t);
        }
        let report = mgr.health(24);
        let populated = report.ecosystems.iter().filter(|e| e.total > 0).count();
        assert!(populated >= 2, "expected >=2 populated series, got {populated}");

        let apple = report
            .ecosystems
            .iter()
            .find(|e| e.ecosystem == EcosystemId::AppleHome)
            .unwrap();
        assert_eq!(apple.total, 60);
        assert_eq!(apple.delivered, 60);
        assert!(apple.avg_latency_ms.is_some());
        assert_eq!(apple.samples.len(), 60); // chartable series

        let google = report
            .ecosystems
            .iter()
            .find(|e| e.ecosystem == EcosystemId::GoogleHome)
            .unwrap();
        // 6 of 60 dropped (i % 10 == 0) → error_rate 0.1.
        assert_eq!(google.total, 60);
        assert!((google.error_rate - 0.1).abs() < 1e-9);
    }

    #[test]
    fn health_window_filters_out_old_samples() {
        let mgr = temp_manager("health-window");
        let now = EcosystemsManager::now_ms();
        // One sample 48h ago, one now.
        mgr.record_health_sample(EcosystemId::AppleHome, true, Some(100), now.saturating_sub(48 * 3_600_000));
        mgr.record_health_sample(EcosystemId::AppleHome, true, Some(100), now);
        let in_24h = mgr.health(24);
        let apple = in_24h.ecosystems.iter().find(|e| e.ecosystem == EcosystemId::AppleHome).unwrap();
        assert_eq!(apple.total, 1, "the 48h-old sample must be outside the 24h window");
        // window_hours = 0 returns everything.
        let all = mgr.health(0);
        let apple_all = all.ecosystems.iter().find(|e| e.ecosystem == EcosystemId::AppleHome).unwrap();
        assert_eq!(apple_all.total, 2);
    }

    #[test]
    fn matter_fabric_drop_raises_recommission_alert() {
        let mgr = temp_manager("health-recommission");
        // Drive a Matter ecosystem Paired → Unpaired via the internal
        // transition (a fabric drop) and assert the alert counter ticks.
        mgr.set_pairing(EcosystemId::GoogleHome, PairingState::Paired);
        mgr.set_pairing(EcosystemId::GoogleHome, PairingState::Unpaired);
        let report = mgr.health(24);
        let google = report.ecosystems.iter().find(|e| e.ecosystem == EcosystemId::GoogleHome).unwrap();
        assert_eq!(google.recommission_alerts, 1);
        // Apple (HAP, not a Matter fabric) never raises this alert.
        mgr.set_pairing(EcosystemId::AppleHome, PairingState::Paired);
        mgr.set_pairing(EcosystemId::AppleHome, PairingState::Unpaired);
        let report2 = mgr.health(24);
        let apple = report2.ecosystems.iter().find(|e| e.ecosystem == EcosystemId::AppleHome).unwrap();
        assert_eq!(apple.recommission_alerts, 0);
    }

    #[test]
    fn update_mapping_rejects_non_editable_rows() {
        let mgr = temp_manager("update");
        let bad = MappingRow {
            ruview_entity: "identity_risk_score".to_string(),
            ecosystem: EcosystemId::AppleHome,
            primitive: "leak".to_string(),
            editable: true, // caller-claimed; manager checks the real table
        };
        assert!(matches!(
            mgr.update_mapping(bad),
            Err(EcoError::MappingNotEditable { .. })
        ));

        let good = MappingRow {
            ruview_entity: "presence".to_string(),
            ecosystem: EcosystemId::AppleHome,
            primitive: "MotionSensor (custom)".to_string(),
            editable: true,
        };
        assert!(mgr.update_mapping(good).is_ok());
        // Persisted override shows up in the rendered table.
        let table = mgr.mappings();
        assert!(table.rows.iter().any(|r| {
            r.ecosystem == EcosystemId::AppleHome
                && r.ruview_entity == "presence"
                && r.primitive == "MotionSensor (custom)"
        }));
    }
}
