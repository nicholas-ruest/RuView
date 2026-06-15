//! ADR-172 ECO-FABRIC — integration tests for the `/api/v1/ecosystems/`
//! REST namespace.
//!
//! These assert (a) the ADR-161 threat model holds on every new route —
//! a missing/wrong bearer is `401` and never leaks ecosystem state — and
//! (b) the §2.1 degradation contract + §2.5 privacy floor are enforced
//! end-to-end through the router.
//!
//! The "fail-on-old" pin here is the auth gate: the routes did not exist
//! before this ADR, so the relevant regression guard is that they refuse
//! unauthenticated access exactly like the hardened REST/WS paths (a
//! route that returned 200 to a missing bearer would be the ADR-161
//! `GET /api/` bug class reintroduced).

use std::sync::atomic::{AtomicU64, Ordering};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use homecore::HomeCore;
use homecore_api::{router, LongLivedTokenStore, SharedState};
use homecore_ecosystems::EcosystemsManager;
use http_body_util::BodyExt;
use tower::ServiceExt; // for `oneshot`

const GOOD: &str = "eco_fabric_good_token";

// Each test gets an isolated Seed-config path so parallel privacy writes
// never race on a shared file.
static SEQ: AtomicU64 = AtomicU64::new(0);

async fn provisioned_state() -> SharedState {
    let store = LongLivedTokenStore::empty();
    store.register(GOOD).await;
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("eco-test-{}-{}.toml", std::process::id(), n));
    let manager = EcosystemsManager::new(path);
    SharedState::with_full(HomeCore::new(), "Home", "test", store, manager)
}

fn get(uri: &str, bearer: Option<&str>) -> Request<Body> {
    let mut b = Request::builder().uri(uri).method("GET");
    if let Some(t) = bearer {
        b = b.header("Authorization", format!("Bearer {t}"));
    }
    b.body(Body::empty()).unwrap()
}

fn post(uri: &str, bearer: Option<&str>, body: &str) -> Request<Body> {
    let mut b = Request::builder().uri(uri).method("POST").header("Content-Type", "application/json");
    if let Some(t) = bearer {
        b = b.header("Authorization", format!("Bearer {t}"));
    }
    b.body(Body::from(body.to_owned())).unwrap()
}

fn put(uri: &str, bearer: Option<&str>, body: &str) -> Request<Body> {
    let mut b = Request::builder().uri(uri).method("PUT").header("Content-Type", "application/json");
    if let Some(t) = bearer {
        b = b.header("Authorization", format!("Bearer {t}"));
    }
    b.body(Body::from(body.to_owned())).unwrap()
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
}

// ── ADR-161 threat model: every route is BearerAuth-gated ────────────

#[tokio::test]
async fn status_rejects_missing_bearer() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(get("/api/v1/ecosystems/status", None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn status_rejects_wrong_bearer() {
    let app = router(provisioned_state().await);
    let resp = app
        .oneshot(get("/api/v1/ecosystems/status", Some("not_the_token")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn ping_all_rejects_missing_bearer() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(post("/api/v1/ecosystems/ping-all", None, "")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn privacy_rejects_missing_bearer() {
    let app = router(provisioned_state().await);
    let resp = app
        .oneshot(put("/api/v1/ecosystems/google_home/privacy", None, "{\"privacy_class\":3}"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── P1 — read-only status: four cards, correct shape ─────────────────

#[tokio::test]
async fn status_returns_all_four_ecosystems() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(get("/api/v1/ecosystems/status", Some(GOOD))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    let ecos = v["ecosystems"].as_array().expect("ecosystems array");
    assert_eq!(ecos.len(), 4);
    let ids: Vec<&str> = ecos.iter().map(|e| e["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["apple_home", "google_home", "amazon_alexa", "smartthings"]);
    // Matter ecosystems must advertise feature_available=false (SDK gated to v0.7.1).
    let google = ecos.iter().find(|e| e["id"] == "google_home").unwrap();
    assert_eq!(google["feature_available"], false);
    assert_eq!(google["protocol"], "matter-1.4");
}

#[tokio::test]
async fn matter_qr_returns_real_manual_code() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(get("/api/v1/ecosystems/matter/qr", Some(GOOD))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    let code = v["manual_code"].as_str().unwrap();
    assert_eq!(code.len(), 11, "manual code must be 11 digits");
    assert!(code.chars().all(|c| c.is_ascii_digit()));
    // QR string itself is a v0.7.1 follow-up — null today.
    assert!(v["qr_payload"].is_null());
}

// ── P3 — degradation contract: pairing returns documented 409s ───────

#[tokio::test]
async fn apple_pair_returns_409_when_hap_server_off() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(post("/api/v1/ecosystems/apple/pair", Some(GOOD), "")).await.unwrap();
    // Default build: the `apple-live` feature is off → 409 hap_server_disabled.
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "hap_server_disabled");
}

#[tokio::test]
async fn matter_commission_returns_409_when_sdk_off() {
    let app = router(provisioned_state().await);
    let resp = app
        .oneshot(post(
            "/api/v1/ecosystems/matter/commission",
            Some(GOOD),
            "{\"ecosystem\":\"google_home\"}",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "matter_sdk_unavailable");
}

// ── P2 — privacy floor: class < 2 is rejected 422 ────────────────────

#[tokio::test]
async fn privacy_floor_rejects_class_below_two() {
    let app = router(provisioned_state().await);
    let resp = app
        .oneshot(put(
            "/api/v1/ecosystems/google_home/privacy",
            Some(GOOD),
            "{\"privacy_class\":1}",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "class_below_floor");
}

#[tokio::test]
async fn privacy_accepts_restricted_class_three() {
    let app = router(provisioned_state().await);
    let resp = app
        .oneshot(put(
            "/api/v1/ecosystems/google_home/privacy",
            Some(GOOD),
            "{\"privacy_class\":3}",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["privacy_class"], 3);
    assert_eq!(v["applied"], true);
}

#[tokio::test]
async fn unknown_ecosystem_slug_is_404() {
    let app = router(provisioned_state().await);
    let resp = app
        .oneshot(put("/api/v1/ecosystems/nope/privacy", Some(GOOD), "{\"privacy_class\":2}"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn ping_all_reports_four_unpaired_initially() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(post("/api/v1/ecosystems/ping-all", Some(GOOD), "")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    let results = v["results"].as_array().unwrap();
    assert_eq!(results.len(), 4);
    assert!(results.iter().all(|r| r["delivered"] == false));
}

// ── P4 — longitudinal health endpoint ────────────────────────────────

#[tokio::test]
async fn health_rejects_missing_bearer() {
    let app = router(provisioned_state().await);
    let resp = app.oneshot(get("/api/v1/ecosystems/health", None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn health_returns_four_series_and_populates_after_ping() {
    let state = provisioned_state().await;
    // A ping records one health datapoint per ecosystem.
    state.ecosystems().ping_all();
    let app = router(state);
    let resp = app.oneshot(get("/api/v1/ecosystems/health", Some(GOOD))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["window_hours"], 24);
    let ecos = v["ecosystems"].as_array().unwrap();
    assert_eq!(ecos.len(), 4);
    // Each series has its recorded datapoint and an error_rate field.
    assert!(ecos.iter().all(|e| e["total"].as_u64().unwrap() >= 1));
    assert!(ecos.iter().all(|e| e["samples"].is_array()));
    assert!(ecos.iter().all(|e| e["error_rate"].is_number()));
}
