use std::path::PathBuf;
use std::sync::Arc;
use homecore::HomeCore;
use homecore_ecosystems::EcosystemsManager;

use crate::tokens::LongLivedTokenStore;

#[derive(Clone)]
pub struct SharedState {
    inner: Arc<SharedStateInner>,
}

struct SharedStateInner {
    pub homecore: HomeCore,
    pub homecore_version: String,
    pub location_name: String,
    pub tokens: LongLivedTokenStore,
    /// ADR-172 ECO-FABRIC — owns per-ecosystem pairing/mapping/privacy
    /// state. `EcosystemsManager` is `Clone` (Arc-inner) and `Send + Sync`.
    pub ecosystems: EcosystemsManager,
}

/// Resolve the Seed config path for the ECO-FABRIC manager. Honors
/// `RUVIEW_SEED_CONFIG`; otherwise a writable temp-dir default so a bare
/// `cargo run` / test never needs a privileged path (the bins override
/// this with the real Seed config location).
fn default_seed_config_path() -> PathBuf {
    match std::env::var("RUVIEW_SEED_CONFIG") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => std::env::temp_dir().join("ruview-seed.toml"),
    }
}

impl SharedState {
    /// New SharedState with a default empty token store. Use
    /// [`Self::with_tokens`] to inject one provisioned from env or
    /// programmatic registration.
    pub fn new(homecore: HomeCore) -> Self {
        Self::with_metadata(homecore, "Home", env!("CARGO_PKG_VERSION"))
    }

    pub fn with_metadata(
        homecore: HomeCore,
        location_name: impl Into<String>,
        homecore_version: impl Into<String>,
    ) -> Self {
        // P2 default: dev-mode token store (accepts any non-empty
        // bearer) so existing smoke tests still work; the
        // `homecore-server` binary uses with_tokens() to provision a
        // real store at boot.
        Self::with_tokens(
            homecore,
            location_name,
            homecore_version,
            LongLivedTokenStore::allow_any_non_empty(),
        )
    }

    pub fn with_tokens(
        homecore: HomeCore,
        location_name: impl Into<String>,
        homecore_version: impl Into<String>,
        tokens: LongLivedTokenStore,
    ) -> Self {
        Self::with_full(
            homecore,
            location_name,
            homecore_version,
            tokens,
            EcosystemsManager::new(default_seed_config_path()),
        )
    }

    /// Full constructor used by the server bins to inject an
    /// [`EcosystemsManager`] backed by the real Seed config path
    /// (ADR-172). The other constructors delegate here with a
    /// temp-dir-backed default manager.
    pub fn with_full(
        homecore: HomeCore,
        location_name: impl Into<String>,
        homecore_version: impl Into<String>,
        tokens: LongLivedTokenStore,
        ecosystems: EcosystemsManager,
    ) -> Self {
        Self {
            inner: Arc::new(SharedStateInner {
                homecore,
                homecore_version: homecore_version.into(),
                location_name: location_name.into(),
                tokens,
                ecosystems,
            }),
        }
    }

    pub fn homecore(&self) -> &HomeCore { &self.inner.homecore }
    pub fn version(&self) -> &str { &self.inner.homecore_version }
    pub fn location_name(&self) -> &str { &self.inner.location_name }
    pub fn tokens(&self) -> &LongLivedTokenStore { &self.inner.tokens }
    /// ADR-172 — the ECO-FABRIC ecosystems manager.
    pub fn ecosystems(&self) -> &EcosystemsManager { &self.inner.ecosystems }
}
