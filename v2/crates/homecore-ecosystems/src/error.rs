//! ECO-FABRIC error type (ADR-172 §2.3).
//!
//! Each variant maps to a documented REST response. The `error` code
//! string is stable (homecore-api maps it to 409 / 422 status codes);
//! the `message` is operator-facing. homecore-api translates these via
//! [`EcoError::code`] / [`EcoError::http_status`].

use thiserror::Error;

/// Domain errors surfaced by [`crate::EcosystemsManager`].
#[derive(Debug, Error)]
pub enum EcoError {
    /// The `hap-server` feature is not compiled in, so the live HAP
    /// advertiser is unavailable. → `409 hap_server_disabled`.
    #[error("homecore-hap built without the hap-server feature")]
    HapServerDisabled,

    /// The Matter SDK (rs-matter / chip-tool FFI) is not wired in until
    /// v0.7.1, so live commissioning is unavailable. → `409
    /// matter_sdk_unavailable`.
    #[error("Matter commissioning unavailable until v0.7.1")]
    MatterSdkUnavailable,

    /// An attempt to drop a networked ecosystem below class 2
    /// (`anonymous`). → `422 class_below_floor`.
    #[error("consumer ecosystems may not drop below class 2 (anonymous)")]
    ClassBelowFloor {
        /// The rejected class value.
        requested: u8,
    },

    /// An action requiring a paired ecosystem was attempted while it was
    /// unpaired. → `409 unpaired`.
    #[error("ecosystem is not paired")]
    Unpaired,

    /// Commissioning was requested for an ecosystem that is not reached
    /// over Matter (Apple Home). → `422 not_a_matter_ecosystem`.
    #[error("ecosystem is not commissioned over Matter")]
    NotAMatterEcosystem,

    /// An edit was attempted on a non-editable (internal-only) mapping
    /// row. → `422 mapping_not_editable`.
    #[error("mapping row '{entity}' is internal-only and not editable")]
    MappingNotEditable {
        /// The entity whose row was rejected.
        entity: String,
    },

    /// A config read/write failed. → `500 io`.
    #[error("ecosystem config I/O error: {0}")]
    Io(String),

    /// A config parse / serialize failed. → `500 config`.
    #[error("ecosystem config error: {0}")]
    Config(String),
}

impl EcoError {
    /// The stable machine-readable error code (the `error` JSON field).
    pub fn code(&self) -> &'static str {
        match self {
            EcoError::HapServerDisabled => "hap_server_disabled",
            EcoError::MatterSdkUnavailable => "matter_sdk_unavailable",
            EcoError::ClassBelowFloor { .. } => "class_below_floor",
            EcoError::Unpaired => "unpaired",
            EcoError::NotAMatterEcosystem => "not_a_matter_ecosystem",
            EcoError::MappingNotEditable { .. } => "mapping_not_editable",
            EcoError::Io(_) => "io",
            EcoError::Config(_) => "config",
        }
    }

    /// The HTTP status homecore-api should return for this error.
    /// 409 for "documented-but-disabled" paths, 422 for validation,
    /// 500 for infrastructure faults.
    pub fn http_status(&self) -> u16 {
        match self {
            EcoError::HapServerDisabled
            | EcoError::MatterSdkUnavailable
            | EcoError::Unpaired => 409,
            EcoError::ClassBelowFloor { .. }
            | EcoError::NotAMatterEcosystem
            | EcoError::MappingNotEditable { .. } => 422,
            EcoError::Io(_) | EcoError::Config(_) => 500,
        }
    }

    /// The `{ "error": code, "message": msg }` body homecore-api returns.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "error": self.code(), "message": self.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_statuses_are_stable() {
        assert_eq!(EcoError::HapServerDisabled.code(), "hap_server_disabled");
        assert_eq!(EcoError::HapServerDisabled.http_status(), 409);
        assert_eq!(EcoError::MatterSdkUnavailable.code(), "matter_sdk_unavailable");
        assert_eq!(EcoError::MatterSdkUnavailable.http_status(), 409);
        assert_eq!(
            EcoError::ClassBelowFloor { requested: 1 }.code(),
            "class_below_floor"
        );
        assert_eq!(
            EcoError::ClassBelowFloor { requested: 1 }.http_status(),
            422
        );
        assert_eq!(EcoError::Unpaired.http_status(), 409);
    }

    #[test]
    fn to_json_has_error_and_message() {
        let v = EcoError::MatterSdkUnavailable.to_json();
        assert_eq!(v["error"], "matter_sdk_unavailable");
        assert_eq!(v["message"], "Matter commissioning unavailable until v0.7.1");
    }
}
