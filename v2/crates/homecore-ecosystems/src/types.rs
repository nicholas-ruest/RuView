//! ECO-FABRIC domain types (ADR-172 §2.3).
//!
//! These serialize directly to the `/api/v1/ecosystems/` REST responses,
//! so the serde representations are part of the API contract and are
//! pinned by the unit tests at the bottom of this module.

use serde::{Deserialize, Serialize};

/// The four consumer ecosystems ECO-FABRIC speaks to (ADR-172 §1.3).
///
/// The serde wire form is the snake_case slug used in the REST paths
/// (`/api/v1/ecosystems/{eco}/privacy`) and the `status` array.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EcosystemId {
    /// Apple Home — HAP-1.1 over mDNS/Bonjour.
    AppleHome,
    /// Google Home — Matter 1.4, fabric A.
    GoogleHome,
    /// Amazon Alexa — Matter 1.4, fabric B (separate fabric).
    AmazonAlexa,
    /// Samsung SmartThings — Matter 1.4, fabric C (separate fabric).
    #[serde(rename = "smartthings")]
    SmartThings,
}

impl EcosystemId {
    /// All four ecosystems in the canonical ADR-172 §2.3 order. The
    /// `status` array is always rendered in exactly this order.
    pub const ALL: [EcosystemId; 4] = [
        EcosystemId::AppleHome,
        EcosystemId::GoogleHome,
        EcosystemId::AmazonAlexa,
        EcosystemId::SmartThings,
    ];

    /// The wire protocol this ecosystem is reached over.
    pub fn protocol(self) -> &'static str {
        match self {
            EcosystemId::AppleHome => "hap-1.1",
            EcosystemId::GoogleHome
            | EcosystemId::AmazonAlexa
            | EcosystemId::SmartThings => "matter-1.4",
        }
    }

    /// The snake_case config-key / URL-slug form. Stable; used as the
    /// TOML key in `[ecosystems.privacy_overrides]`.
    pub fn slug(self) -> &'static str {
        match self {
            EcosystemId::AppleHome => "apple_home",
            EcosystemId::GoogleHome => "google_home",
            EcosystemId::AmazonAlexa => "amazon_alexa",
            EcosystemId::SmartThings => "smartthings",
        }
    }

    /// Parse a slug back into an `EcosystemId` (for URL path params).
    pub fn from_slug(s: &str) -> Option<EcosystemId> {
        match s {
            "apple_home" => Some(EcosystemId::AppleHome),
            "google_home" => Some(EcosystemId::GoogleHome),
            "amazon_alexa" => Some(EcosystemId::AmazonAlexa),
            "smartthings" => Some(EcosystemId::SmartThings),
            _ => None,
        }
    }

    /// True iff this ecosystem is reached over Matter (the three
    /// non-Apple ecosystems). Apple Home is HAP-only.
    pub fn is_matter(self) -> bool {
        !matches!(self, EcosystemId::AppleHome)
    }
}

/// Per-ecosystem pairing state (ADR-172 §2.3 `pairing` field).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairingState {
    /// Commissioned / advertised and reachable.
    Paired,
    /// Not yet paired (the default state on a fresh Seed).
    Unpaired,
    /// A pairing or advertisement error occurred.
    Error,
}

/// Per-ecosystem health indicator (ADR-172 §2.3 `health` field).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    /// Healthy.
    Ok,
    /// Reachable but degraded (e.g. broadcast lag, partial delivery).
    Degraded,
    /// Unreachable.
    Down,
}

/// ADR-120 privacy class, constrained to the values valid on a networked
/// ecosystem boundary. ECO-FABRIC's §2.5 fail-closed floor means a
/// consumer ecosystem may only ever be `Anonymous` (2) or `Restricted`
/// (3); classes 0 (`raw`) and 1 (`derived`) never leave the node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrivacyClass(u8);

impl PrivacyClass {
    /// Class 2 — aggregate presence / motion / person count / zone /
    /// confidence. The production default for a consumer ecosystem.
    pub const ANONYMOUS: PrivacyClass = PrivacyClass(2);
    /// Class 3 — class 2 minus `identity_risk_score` and
    /// `rf_signature_hash`. For care-home / regulated deployments.
    pub const RESTRICTED: PrivacyClass = PrivacyClass(3);

    /// The floor for a networked ecosystem. Anything below is rejected.
    pub const FLOOR: u8 = 2;

    /// Build a validated class. Returns `Err` if `class < 2`, preserving
    /// ADR-120 invariant I1 (raw/derived BFI never crosses the boundary).
    pub fn new(class: u8) -> Result<PrivacyClass, crate::EcoError> {
        if class < Self::FLOOR {
            return Err(crate::EcoError::ClassBelowFloor { requested: class });
        }
        Ok(PrivacyClass(class))
    }

    /// The raw numeric class value.
    pub fn value(self) -> u8 {
        self.0
    }
}

/// One ecosystem's row in the `status` snapshot (ADR-172 §2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemStatus {
    /// Which ecosystem this row describes.
    pub id: EcosystemId,
    /// Wire protocol: `"hap-1.1"` or `"matter-1.4"`.
    pub protocol: String,
    /// Current pairing state.
    pub pairing: PairingState,
    /// Current health indicator.
    pub health: Health,
    /// Whether the live feature gate (hap-server / Matter SDK) is
    /// compiled into the running binary.
    pub feature_available: bool,
    /// The effective privacy class for this ecosystem (override or
    /// global default), always `>= 2`.
    pub privacy_class: u8,
    /// Ecosystem-specific identifiers / status (mdns/pin, fabric_id, …).
    pub details: serde_json::Value,
}

/// The full `GET /status` snapshot — always all four ecosystems, in the
/// ADR-172 §2.3 order (`apple_home`, `google_home`, `amazon_alexa`,
/// `smartthings`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemsStatus {
    /// Per-ecosystem status rows.
    pub ecosystems: Vec<EcosystemStatus>,
}

/// `GET /matter/qr` response (ADR-172 §2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatterQr {
    /// `MT:`-prefixed QR payload. `None` until QR generation lands in
    /// v0.7.1 (ADR-172 §5); the manual code works in all four apps today.
    pub qr_payload: Option<String>,
    /// The 11-digit manual pairing code, real today from the Matter
    /// commissioning module (Matter Core Spec 1.3 §5.1.4.1.1).
    pub manual_code: String,
    /// The 12-bit discriminator advertised in mDNS.
    pub discriminator: u16,
    /// CSA dev vendor ID (`0xFFF1`).
    pub vendor_id: u16,
    /// Vendor product ID (`0x8001`).
    pub product_id: u16,
}

/// One row of the entity → ecosystem-primitive mapping table
/// (ADR-172 §2.1.a / §2.1.b).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MappingRow {
    /// The RuView sensor entity (e.g. `presence`, `fall_risk_elevated`).
    pub ruview_entity: String,
    /// Which ecosystem this row maps into.
    pub ecosystem: EcosystemId,
    /// The ecosystem-native primitive (HAP service / Matter cluster).
    pub primitive: String,
    /// Whether the operator may edit this row. Internal-only fields
    /// (`identity_risk_score`, `rf_signature_hash`) are never editable.
    pub editable: bool,
}

/// `GET /mappings` response (ADR-172 §2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappingTable {
    /// All mapping rows across the four ecosystems.
    pub rows: Vec<MappingRow>,
}

/// One ecosystem's result in a ping-all run (ADR-172 §2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    /// Which ecosystem was pinged.
    pub ecosystem: EcosystemId,
    /// Whether the synthetic test event was delivered.
    pub delivered: bool,
    /// Round-trip latency in ms when delivered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// Reason the event was not delivered (e.g. `"unpaired"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `POST /ping-all` response (ADR-172 §2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingReport {
    /// Per-ecosystem delivery results.
    pub results: Vec<PingResult>,
}

/// One longitudinal health datapoint (ADR-172 §2.5 / P4). Recorded on
/// every `ping_all` and chartable over a time window.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HealthSample {
    /// Unix-epoch milliseconds the sample was taken.
    pub t_ms: u64,
    /// Whether the synthetic event was delivered at this datapoint.
    pub delivered: bool,
    /// Round-trip latency in ms when delivered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

/// One ecosystem's windowed health series (ADR-172 P4 — the per-ecosystem
/// latency chart + delivery/error rates + re-commissioning alerts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcoHealthSeries {
    /// Which ecosystem this series describes.
    pub ecosystem: EcosystemId,
    /// Samples within the requested window, oldest-first (the chart data).
    pub samples: Vec<HealthSample>,
    /// Delivered datapoints in the window.
    pub delivered: u32,
    /// Total datapoints in the window.
    pub total: u32,
    /// Fraction `[0,1]` of windowed datapoints that failed to deliver.
    pub error_rate: f64,
    /// Mean delivered latency in ms over the window (`None` if no
    /// delivered samples).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_latency_ms: Option<f64>,
    /// Count of Matter fabric re-commissioning alerts (a previously
    /// commissioned fabric that dropped and required re-commissioning).
    pub recommission_alerts: u32,
}

/// `GET /api/v1/ecosystems/health` response (ADR-172 P4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    /// The look-back window, in hours, the series cover.
    pub window_hours: u32,
    /// Per-ecosystem series, in the ADR §2.3 order.
    pub ecosystems: Vec<EcoHealthSeries>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecosystem_id_serializes_to_snake_case_slugs() {
        let pairs = [
            (EcosystemId::AppleHome, "\"apple_home\""),
            (EcosystemId::GoogleHome, "\"google_home\""),
            (EcosystemId::AmazonAlexa, "\"amazon_alexa\""),
            (EcosystemId::SmartThings, "\"smartthings\""),
        ];
        for (id, json) in pairs {
            assert_eq!(serde_json::to_string(&id).unwrap(), json);
            assert_eq!(id.slug(), json.trim_matches('"'));
            assert_eq!(EcosystemId::from_slug(id.slug()), Some(id));
        }
    }

    #[test]
    fn all_is_in_adr_order() {
        assert_eq!(
            EcosystemId::ALL,
            [
                EcosystemId::AppleHome,
                EcosystemId::GoogleHome,
                EcosystemId::AmazonAlexa,
                EcosystemId::SmartThings,
            ]
        );
    }

    #[test]
    fn protocol_strings_match_adr() {
        assert_eq!(EcosystemId::AppleHome.protocol(), "hap-1.1");
        assert_eq!(EcosystemId::GoogleHome.protocol(), "matter-1.4");
        assert_eq!(EcosystemId::AmazonAlexa.protocol(), "matter-1.4");
        assert_eq!(EcosystemId::SmartThings.protocol(), "matter-1.4");
    }

    #[test]
    fn only_apple_is_not_matter() {
        assert!(!EcosystemId::AppleHome.is_matter());
        assert!(EcosystemId::GoogleHome.is_matter());
        assert!(EcosystemId::AmazonAlexa.is_matter());
        assert!(EcosystemId::SmartThings.is_matter());
    }

    #[test]
    fn pairing_and_health_serialize_snake_case() {
        assert_eq!(serde_json::to_string(&PairingState::Paired).unwrap(), "\"paired\"");
        assert_eq!(serde_json::to_string(&PairingState::Unpaired).unwrap(), "\"unpaired\"");
        assert_eq!(serde_json::to_string(&PairingState::Error).unwrap(), "\"error\"");
        assert_eq!(serde_json::to_string(&Health::Ok).unwrap(), "\"ok\"");
        assert_eq!(serde_json::to_string(&Health::Degraded).unwrap(), "\"degraded\"");
        assert_eq!(serde_json::to_string(&Health::Down).unwrap(), "\"down\"");
    }

    #[test]
    fn privacy_class_floor_rejects_below_two() {
        assert_eq!(PrivacyClass::ANONYMOUS.value(), 2);
        assert_eq!(PrivacyClass::RESTRICTED.value(), 3);
        assert!(PrivacyClass::new(2).is_ok());
        assert!(PrivacyClass::new(3).is_ok());
        assert!(PrivacyClass::new(4).is_ok());
        assert!(matches!(
            PrivacyClass::new(1),
            Err(crate::EcoError::ClassBelowFloor { requested: 1 })
        ));
        assert!(matches!(
            PrivacyClass::new(0),
            Err(crate::EcoError::ClassBelowFloor { requested: 0 })
        ));
    }
}
