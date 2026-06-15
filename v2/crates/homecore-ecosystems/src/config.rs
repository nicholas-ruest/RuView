//! Seed config model for ECO-FABRIC (ADR-172 §2.5).
//!
//! TOML schema:
//! ```toml
//! [bfld]
//! privacy_class = 2                 # global default (RUVIEW_BFLD_PRIVACY_CLASS)
//!
//! [ecosystems.privacy_overrides]
//! apple_home   = 2
//! google_home  = 3
//! amazon_alexa = 3
//! smartthings  = 3
//!
//! [ecosystems.mappings]             # optional persisted mapping overrides
//! ```
//!
//! Missing file = defaults (global class 2, no overrides). `effective_class`
//! is the override if present else the global default, and is never below
//! the class-2 floor for a networked ecosystem.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::EcoError;
use crate::types::{EcosystemId, MappingRow, PrivacyClass};

/// The `[bfld]` section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BfldConfig {
    /// Global default privacy class (`RUVIEW_BFLD_PRIVACY_CLASS`).
    pub privacy_class: u8,
}

impl Default for BfldConfig {
    fn default() -> Self {
        // ADR-172 §2.5: class 2 (anonymous) is the production default.
        BfldConfig { privacy_class: PrivacyClass::FLOOR }
    }
}

/// The `[ecosystems]` section.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EcosystemsSection {
    /// Per-ecosystem privacy-class overrides, keyed by ecosystem slug.
    #[serde(default)]
    pub privacy_overrides: BTreeMap<String, u8>,
    /// Optional persisted mapping-row overrides, keyed by a
    /// `"{slug}:{entity}"` composite so each ecosystem/entity is unique.
    #[serde(default)]
    pub mappings: BTreeMap<String, String>,
}

/// The full Seed config relevant to ECO-FABRIC.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EcoConfig {
    /// The `[bfld]` section (global privacy default).
    #[serde(default)]
    pub bfld: BfldConfig,
    /// The `[ecosystems]` section (overrides + mapping persistence).
    #[serde(default)]
    pub ecosystems: EcosystemsSection,
}

impl EcoConfig {
    /// Load config from `path`. A missing file yields defaults (global
    /// class 2, no overrides) rather than an error — a fresh Seed is
    /// valid with no config written yet.
    pub fn load(path: &Path) -> Result<EcoConfig, EcoError> {
        match std::fs::read_to_string(path) {
            Ok(text) => {
                toml::from_str(&text).map_err(|e| EcoError::Config(e.to_string()))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Ok(EcoConfig::default())
            }
            Err(e) => Err(EcoError::Io(e.to_string())),
        }
    }

    /// Atomically persist to `path` (write to a sibling temp file, then
    /// rename) so a crash mid-write never leaves a half-written config.
    pub fn save(&self, path: &Path) -> Result<(), EcoError> {
        let text = toml::to_string_pretty(self)
            .map_err(|e| EcoError::Config(e.to_string()))?;
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| EcoError::Io(e.to_string()))?;
            }
        }
        let tmp = path.with_extension("toml.tmp");
        std::fs::write(&tmp, text.as_bytes()).map_err(|e| EcoError::Io(e.to_string()))?;
        std::fs::rename(&tmp, path).map_err(|e| EcoError::Io(e.to_string()))?;
        Ok(())
    }

    /// The effective class for `eco`: the override if present, else the
    /// global default. Clamped up to the class-2 floor so a malformed or
    /// legacy config can never drop a networked ecosystem below
    /// `anonymous` (ADR-172 §2.5 fail-closed).
    pub fn effective_class(&self, eco: EcosystemId) -> u8 {
        let raw = self
            .ecosystems
            .privacy_overrides
            .get(eco.slug())
            .copied()
            .unwrap_or(self.bfld.privacy_class);
        raw.max(PrivacyClass::FLOOR)
    }

    /// Set (or replace) the override for `eco`. Validates the floor via
    /// [`PrivacyClass::new`]; returns the applied class on success.
    pub fn set_override(&mut self, eco: EcosystemId, class: u8) -> Result<u8, EcoError> {
        let validated = PrivacyClass::new(class)?;
        self.ecosystems
            .privacy_overrides
            .insert(eco.slug().to_string(), validated.value());
        Ok(validated.value())
    }

    /// Persist a single mapping-row override. Keyed by `"{slug}:{entity}"`.
    pub fn set_mapping_override(&mut self, row: &MappingRow) {
        let key = format!("{}:{}", row.ecosystem.slug(), row.ruview_entity);
        self.ecosystems.mappings.insert(key, row.primitive.clone());
    }

    /// Look up a persisted mapping-row override, if any.
    pub fn mapping_override(&self, eco: EcosystemId, entity: &str) -> Option<&String> {
        let key = format!("{}:{}", eco.slug(), entity);
        self.ecosystems.mappings.get(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_yields_defaults() {
        let path = std::env::temp_dir().join("eco-missing-12345.toml");
        let _ = std::fs::remove_file(&path);
        let cfg = EcoConfig::load(&path).unwrap();
        assert_eq!(cfg.bfld.privacy_class, 2);
        assert!(cfg.ecosystems.privacy_overrides.is_empty());
        // No override → falls back to global default, floored at 2.
        assert_eq!(cfg.effective_class(EcosystemId::GoogleHome), 2);
    }

    #[test]
    fn override_persists_round_trip_through_toml() {
        let path = std::env::temp_dir().join("eco-roundtrip-67890.toml");
        let _ = std::fs::remove_file(&path);

        let mut cfg = EcoConfig::default();
        cfg.set_override(EcosystemId::GoogleHome, 3).unwrap();
        cfg.set_override(EcosystemId::AppleHome, 2).unwrap();
        cfg.save(&path).unwrap();

        let reloaded = EcoConfig::load(&path).unwrap();
        assert_eq!(reloaded.effective_class(EcosystemId::GoogleHome), 3);
        assert_eq!(reloaded.effective_class(EcosystemId::AppleHome), 2);
        // No override for Alexa → global default 2.
        assert_eq!(reloaded.effective_class(EcosystemId::AmazonAlexa), 2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_override_rejects_below_floor() {
        let mut cfg = EcoConfig::default();
        assert!(cfg.set_override(EcosystemId::GoogleHome, 1).is_err());
        // The rejected override is not written.
        assert!(cfg.ecosystems.privacy_overrides.is_empty());
    }

    #[test]
    fn effective_class_floors_legacy_config_at_two() {
        // A legacy config that set a global class-1 default must still
        // never expose class 1 on a networked ecosystem.
        let cfg = EcoConfig {
            bfld: BfldConfig { privacy_class: 1 },
            ecosystems: EcosystemsSection::default(),
        };
        assert_eq!(cfg.effective_class(EcosystemId::GoogleHome), 2);
    }

    #[test]
    fn mapping_override_round_trips() {
        let mut cfg = EcoConfig::default();
        let row = MappingRow {
            ruview_entity: "presence".to_string(),
            ecosystem: EcosystemId::GoogleHome,
            primitive: "CustomCluster".to_string(),
            editable: true,
        };
        cfg.set_mapping_override(&row);
        assert_eq!(
            cfg.mapping_override(EcosystemId::GoogleHome, "presence"),
            Some(&"CustomCluster".to_string())
        );
    }
}
