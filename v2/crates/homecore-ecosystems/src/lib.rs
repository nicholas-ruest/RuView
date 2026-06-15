//! # homecore-ecosystems — ECO-FABRIC backend domain (ADR-172)
//!
//! Pure domain logic + an [`EcosystemsManager`] that powers the
//! `/api/v1/ecosystems/` HOMECORE-API namespace. This crate **does not**
//! depend on axum or homecore-api: homecore-api depends on IT, and wires
//! the manager's owned-data methods into REST handlers.
//!
//! ## What it owns (ADR-172)
//!
//! - §2.3 wire types ([`EcosystemStatus`], [`MatterQr`], [`MappingTable`],
//!   [`PingReport`], …) that serialize directly to the REST responses.
//! - §2.5 per-ecosystem privacy-class override config (TOML load/save,
//!   fail-closed class-2 floor).
//! - §2.1 the degradation contract: with `apple-live` / `matter-live`
//!   OFF (the default), pairing/commission return the documented 409s.
//!
//! ## Reuse
//!
//! The Matter manual pairing-code generator is REUSED from
//! `wifi_densepose_sensing_server::matter` (SDK-independent, pure logic),
//! and the Matter cluster mapping table is derived from its
//! `matter_mapping` lookup so the two never drift.
//!
//! ## Features
//!
//! - `apple-live` (off) → forwards to `homecore-hap/hap-server`; enables
//!   the live HAP advertisement path.
//! - `matter-live` (off) → enables the live Matter commissioning path
//!   (rs-matter SDK, gated to v0.7.1).

#![forbid(unsafe_code)]

pub mod config;
pub mod error;
pub mod manager;
pub mod mapping;
pub mod types;

pub use config::EcoConfig;
pub use error::EcoError;
pub use manager::EcosystemsManager;
pub use mapping::{row_is_editable, seed_mapping_table};
pub use types::{
    EcoHealthSeries, EcosystemId, EcosystemStatus, EcosystemsStatus, Health, HealthReport,
    HealthSample, MappingRow, MappingTable, MatterQr, PairingState, PingReport, PingResult,
    PrivacyClass,
};
