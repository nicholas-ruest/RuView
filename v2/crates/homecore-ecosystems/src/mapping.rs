//! Seed mapping table (ADR-172 §2.1.a / §2.1.b).
//!
//! Builds the entity → ecosystem-primitive rows the UI renders. The
//! Apple Home rows follow the ADR §2.1.a HAP table; the Matter rows
//! (Google Home / Alexa / SmartThings) are derived from the REUSED
//! `wifi_densepose_sensing_server::matter::matter_mapping` lookup keyed
//! by `EntityKind`, so the table stays in sync with the canonical Matter
//! cluster mapping rather than duplicating it.
//!
//! Internal-only fields (`identity_risk_score`, `rf_signature_hash`)
//! never cross any boundary and are rendered read-only (`editable:false`),
//! restating ADR-125 §2.1.d / ADR-118 §2.5.

use wifi_densepose_sensing_server::matter::matter_mapping;
use wifi_densepose_sensing_server::mqtt::discovery::EntityKind;

use crate::types::{EcosystemId, MappingRow, MappingTable};

/// RuView entities that are internal-only and must never be exposed on
/// any networked ecosystem (ADR-125 §2.1.d). Rendered read-only.
const INTERNAL_ONLY: [&str; 2] = ["identity_risk_score", "rf_signature_hash"];

/// Apple Home (HAP-1.1) rows, per the ADR §2.1.a mapping table.
/// `(entity, HAP service → characteristic)`.
const HAP_ROWS: [(&str, &str); 6] = [
    ("presence", "MotionSensor → MotionDetected"),
    ("occupancy", "OccupancySensor → OccupancyDetected"),
    ("ambient_temp_c", "TemperatureSensor → CurrentTemperature"),
    ("unknown_presence", "MotionSensor (stateful, programmable)"),
    ("unexpected_occupancy", "OccupancySensor (programmable)"),
    ("unrecognized_activity_pattern", "Switch (stateful, momentary)"),
];

/// The Matter entities (and their RuView slug) that are exposed over
/// Matter, in a stable display order. Each is resolved through the
/// reused `matter_mapping` lookup to produce the primitive string.
const MATTER_ENTITIES: [(EntityKind, &str); 6] = [
    (EntityKind::Presence, "presence"),
    (EntityKind::ZoneOccupancy, "zone_occupancy"),
    (EntityKind::PersonCount, "person_count"),
    (EntityKind::FallRiskElevated, "fall_risk_elevated"),
    (EntityKind::FallDetected, "fall"),
    (EntityKind::BedExit, "bed_exit"),
];

/// Matter entities that are deliberately MQTT-only (no Matter cluster),
/// shown as an explicit "MQTT-only" row rather than an empty cell
/// (ADR-172 §2.1.b).
const MATTER_MQTT_ONLY: [&str; 3] = ["heart_rate", "breathing_rate", "pose_keypoints"];

/// Render a Matter cluster mapping into a human-readable primitive
/// string for the mapping table cell.
fn matter_primitive(entity: EntityKind) -> String {
    match matter_mapping(entity) {
        Some(m) => {
            let vendor = match m.vendor_attr_id {
                Some(id) => format!(", vendor attr 0x{id:08X}"),
                None => String::new(),
            };
            let event = match m.event_id {
                Some(id) => format!(", event 0x{id:02X}"),
                None => String::new(),
            };
            format!(
                "cluster 0x{:04X} → device 0x{:04X}{}{}",
                m.cluster, m.device_type, vendor, event
            )
        }
        None => "MQTT-only (no Matter cluster)".to_string(),
    }
}

/// Build the full seed mapping table across all four ecosystems.
///
/// Order: Apple Home rows, then for each Matter ecosystem (Google Home,
/// Alexa, SmartThings) the Matter rows, then the MQTT-only rows, then
/// the internal-only read-only rows on every ecosystem.
pub fn seed_mapping_table() -> MappingTable {
    let mut rows = Vec::new();

    // Apple Home (HAP).
    for (entity, primitive) in HAP_ROWS {
        rows.push(MappingRow {
            ruview_entity: entity.to_string(),
            ecosystem: EcosystemId::AppleHome,
            primitive: primitive.to_string(),
            editable: true,
        });
    }

    // The three Matter fabrics share the same cluster map.
    let matter_ecos = [
        EcosystemId::GoogleHome,
        EcosystemId::AmazonAlexa,
        EcosystemId::SmartThings,
    ];
    for eco in matter_ecos {
        for (kind, slug) in MATTER_ENTITIES {
            rows.push(MappingRow {
                ruview_entity: slug.to_string(),
                ecosystem: eco,
                primitive: matter_primitive(kind),
                editable: true,
            });
        }
        for slug in MATTER_MQTT_ONLY {
            rows.push(MappingRow {
                ruview_entity: slug.to_string(),
                ecosystem: eco,
                primitive: "MQTT-only (no Matter cluster)".to_string(),
                editable: false,
            });
        }
    }

    // Internal-only rows: shown read-only on every ecosystem so the UI
    // can render them greyed and the operator cannot expose them.
    for entity in INTERNAL_ONLY {
        for eco in EcosystemId::ALL {
            rows.push(MappingRow {
                ruview_entity: entity.to_string(),
                ecosystem: eco,
                primitive: "never exposed".to_string(),
                editable: false,
            });
        }
    }

    MappingTable { rows }
}

/// Whether a given `(ecosystem, entity)` row is editable. Internal-only
/// entities and Matter MQTT-only entities are never editable.
pub fn row_is_editable(eco: EcosystemId, entity: &str) -> bool {
    if INTERNAL_ONLY.contains(&entity) {
        return false;
    }
    if eco.is_matter() && MATTER_MQTT_ONLY.contains(&entity) {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_contains_all_four_ecosystems() {
        let table = seed_mapping_table();
        for eco in EcosystemId::ALL {
            assert!(
                table.rows.iter().any(|r| r.ecosystem == eco),
                "missing rows for {eco:?}"
            );
        }
    }

    #[test]
    fn internal_only_rows_are_read_only() {
        let table = seed_mapping_table();
        let internal: Vec<_> = table
            .rows
            .iter()
            .filter(|r| INTERNAL_ONLY.contains(&r.ruview_entity.as_str()))
            .collect();
        assert!(!internal.is_empty());
        assert!(internal.iter().all(|r| !r.editable));
        // identity_risk_score appears on every ecosystem.
        assert_eq!(
            internal
                .iter()
                .filter(|r| r.ruview_entity == "identity_risk_score")
                .count(),
            EcosystemId::ALL.len()
        );
    }

    #[test]
    fn matter_primitive_reflects_reused_cluster_map() {
        // presence → OccupancySensing (0x0406) → OccupancySensor (0x0107)
        let p = matter_primitive(EntityKind::Presence);
        assert!(p.contains("0x0406"), "got: {p}");
        assert!(p.contains("0x0107"), "got: {p}");
        // person_count carries the vendor person-count attribute.
        let pc = matter_primitive(EntityKind::PersonCount);
        assert!(pc.contains("FFF10001"), "got: {pc}");
    }

    #[test]
    fn mqtt_only_matter_rows_are_read_only() {
        let table = seed_mapping_table();
        let hr: Vec<_> = table
            .rows
            .iter()
            .filter(|r| r.ruview_entity == "heart_rate" && r.ecosystem.is_matter())
            .collect();
        assert_eq!(hr.len(), 3); // three Matter fabrics
        assert!(hr.iter().all(|r| !r.editable));
    }

    #[test]
    fn row_is_editable_blocks_internal_and_mqtt_only() {
        assert!(!row_is_editable(EcosystemId::AppleHome, "identity_risk_score"));
        assert!(!row_is_editable(EcosystemId::GoogleHome, "heart_rate"));
        assert!(row_is_editable(EcosystemId::AppleHome, "presence"));
        assert!(row_is_editable(EcosystemId::GoogleHome, "presence"));
    }
}
