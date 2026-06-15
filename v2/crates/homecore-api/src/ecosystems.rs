//! ADR-172 ECO-FABRIC — `/api/v1/ecosystems/` REST handlers.
//!
//! One unified control surface over Apple Home (HAP-1.1), Google Home,
//! Amazon Alexa, and Samsung SmartThings (Matter 1.4, three fabrics).
//! Every route is gated behind the SAME `BearerAuth` token whitelist the
//! rest of HOMECORE-API enforces (ADR-161): a missing/wrong bearer is
//! `401` and none of these routes is reachable unauthenticated.
//!
//! The business logic lives in the `homecore-ecosystems` crate
//! ([`EcosystemsManager`], held on [`SharedState`]); these handlers are a
//! thin auth + JSON + event-fire shell. The degradation contract
//! (ADR-172 §2.1) is enforced in the manager: with the `apple-live` /
//! `matter-live` features OFF (the default), pairing/commission return
//! the documented `409`s rather than pretending to work.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use homecore::{Context, DomainEvent};
use homecore_ecosystems::{
    EcoError, EcosystemId, EcosystemsStatus, HealthReport, MappingRow, MappingTable, MatterQr,
    PingReport,
};

use crate::auth::BearerAuth;
use crate::state::SharedState;

/// Unified error for the ecosystems routes. Maps auth failures to `401`
/// and [`EcoError`] to the status the domain crate prescribes (409 for
/// disabled-feature pairing, 422 for the privacy-class floor, etc.).
pub enum EcoApiError {
    Unauthorized,
    UnknownEcosystem(String),
    Eco(EcoError),
}

impl From<EcoError> for EcoApiError {
    fn from(e: EcoError) -> Self {
        EcoApiError::Eco(e)
    }
}

impl IntoResponse for EcoApiError {
    fn into_response(self) -> Response {
        match self {
            EcoApiError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, Json(json!({ "message": "unauthorized" }))).into_response()
            }
            EcoApiError::UnknownEcosystem(slug) => (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": "unknown_ecosystem",
                    "message": format!("unknown ecosystem '{slug}'")
                })),
            )
                .into_response(),
            EcoApiError::Eco(e) => {
                let status =
                    StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
                (status, Json(e.to_json())).into_response()
            }
        }
    }
}

type EcoResult<T> = Result<T, EcoApiError>;

/// Gate a request on the same bearer-token whitelist as every other
/// HOMECORE-API route (ADR-161). Returns `401` on a missing/wrong token.
async fn require_auth(headers: &HeaderMap, s: &SharedState) -> Result<(), EcoApiError> {
    BearerAuth::from_headers(headers, s.tokens())
        .await
        .map(|_| ())
        .map_err(|_| EcoApiError::Unauthorized)
}

/// Publish an `ecosystem_status_changed` event onto the HOMECORE bus so
/// the UI's WS subscription (ADR-172 §2.4) re-renders the affected cards.
/// The payload is the full status snapshot (idempotent for the client).
fn fire_status_changed(s: &SharedState) {
    let snapshot = s.ecosystems().status();
    let data = serde_json::to_value(&snapshot).unwrap_or_else(|_| json!({}));
    s.homecore()
        .bus()
        .fire_domain(DomainEvent::new("ecosystem_status_changed", data, Context::new()));
}

fn parse_eco(slug: &str) -> EcoResult<EcosystemId> {
    EcosystemId::from_slug(slug).ok_or_else(|| EcoApiError::UnknownEcosystem(slug.to_string()))
}

// ── GET /api/v1/ecosystems/status ────────────────────────────────────
pub async fn status(headers: HeaderMap, State(s): State<SharedState>) -> EcoResult<Json<EcosystemsStatus>> {
    require_auth(&headers, &s).await?;
    Ok(Json(s.ecosystems().status()))
}

// ── GET /api/v1/ecosystems/matter/qr ─────────────────────────────────
pub async fn matter_qr(headers: HeaderMap, State(s): State<SharedState>) -> EcoResult<Json<MatterQr>> {
    require_auth(&headers, &s).await?;
    Ok(Json(s.ecosystems().matter_qr()))
}

// ── POST /api/v1/ecosystems/apple/pair ───────────────────────────────
pub async fn apple_pair(headers: HeaderMap, State(s): State<SharedState>) -> EcoResult<Json<Value>> {
    require_auth(&headers, &s).await?;
    let v = s.ecosystems().pair_apple()?;
    fire_status_changed(&s);
    Ok(Json(v))
}

// ── POST /api/v1/ecosystems/apple/repair ─────────────────────────────
pub async fn apple_repair(headers: HeaderMap, State(s): State<SharedState>) -> EcoResult<Json<Value>> {
    require_auth(&headers, &s).await?;
    let v = s.ecosystems().repair_apple()?;
    fire_status_changed(&s);
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct CommissionBody {
    pub ecosystem: String,
}

// ── POST /api/v1/ecosystems/matter/commission ────────────────────────
pub async fn matter_commission(
    headers: HeaderMap,
    State(s): State<SharedState>,
    Json(body): Json<CommissionBody>,
) -> EcoResult<Json<Value>> {
    require_auth(&headers, &s).await?;
    let eco = parse_eco(&body.ecosystem)?;
    let v = s.ecosystems().commission_matter(eco)?;
    fire_status_changed(&s);
    Ok(Json(v))
}

// ── GET /api/v1/ecosystems/mappings ──────────────────────────────────
pub async fn get_mappings(headers: HeaderMap, State(s): State<SharedState>) -> EcoResult<Json<MappingTable>> {
    require_auth(&headers, &s).await?;
    Ok(Json(s.ecosystems().mappings()))
}

// ── PUT /api/v1/ecosystems/mappings ──────────────────────────────────
pub async fn put_mapping(
    headers: HeaderMap,
    State(s): State<SharedState>,
    Json(row): Json<MappingRow>,
) -> EcoResult<Json<Value>> {
    require_auth(&headers, &s).await?;
    s.ecosystems().update_mapping(row)?;
    fire_status_changed(&s);
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct PrivacyBody {
    pub privacy_class: u8,
}

// ── PUT /api/v1/ecosystems/:eco/privacy ──────────────────────────────
pub async fn set_privacy(
    headers: HeaderMap,
    State(s): State<SharedState>,
    Path(eco): Path<String>,
    Json(body): Json<PrivacyBody>,
) -> EcoResult<Json<Value>> {
    require_auth(&headers, &s).await?;
    let id = parse_eco(&eco)?;
    let applied = s.ecosystems().set_privacy(id, body.privacy_class)?;
    fire_status_changed(&s);
    Ok(Json(json!({
        "ecosystem": id.slug(),
        "privacy_class": applied,
        "applied": true,
    })))
}

// ── POST /api/v1/ecosystems/ping-all ─────────────────────────────────
pub async fn ping_all(headers: HeaderMap, State(s): State<SharedState>) -> EcoResult<Json<PingReport>> {
    require_auth(&headers, &s).await?;
    Ok(Json(s.ecosystems().ping_all()))
}

#[derive(Deserialize)]
pub struct HealthQuery {
    /// Look-back window in hours (default 24; `0` returns all retained).
    pub window_hours: Option<u32>,
}

// ── GET /api/v1/ecosystems/health ────────────────────────────────────
// ADR-172 P4 — per-ecosystem longitudinal latency series + delivery/
// error rate + Matter re-commissioning alerts.
pub async fn health(
    headers: HeaderMap,
    State(s): State<SharedState>,
    Query(q): Query<HealthQuery>,
) -> EcoResult<Json<HealthReport>> {
    require_auth(&headers, &s).await?;
    let window = q.window_hours.unwrap_or(24);
    Ok(Json(s.ecosystems().health(window)))
}
