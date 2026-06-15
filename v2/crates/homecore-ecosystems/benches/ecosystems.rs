//! Criterion benchmarks for the ECO-FABRIC manager hot paths (ADR-172).
//!
//! Run with:
//!
//!     cargo bench -p homecore-ecosystems --bench ecosystems
//!
//! Hot paths covered — these back the `/api/v1/ecosystems/` REST routes,
//! so their cost is the per-request floor the HOMECORE-API handler adds
//! on top of auth:
//! - `status` — the read-only dashboard snapshot (all four ecosystems).
//! - `matter_qr` — the 11-digit manual pairing-code generation
//!   (reused from `wifi_densepose_sensing_server::matter`).
//! - `mappings` — the entity→primitive table seed.
//! - `ping_all` — the synthetic delivery probe across four ecosystems.
//!
//! `set_privacy` is deliberately NOT benched: it persists to disk
//! (TOML write), so it is I/O-bound, not a hot in-memory path.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use homecore_ecosystems::EcosystemsManager;

fn manager() -> EcosystemsManager {
    // Use a non-existent path: load = defaults, and none of the benched
    // methods write, so no file is ever created.
    EcosystemsManager::new(std::env::temp_dir().join("eco-bench-nonexistent.toml"))
}

fn bench_status(c: &mut Criterion) {
    let m = manager();
    c.bench_function("status", |b| b.iter(|| black_box(m.status())));
}

fn bench_matter_qr(c: &mut Criterion) {
    let m = manager();
    c.bench_function("matter_qr", |b| b.iter(|| black_box(m.matter_qr())));
}

fn bench_mappings(c: &mut Criterion) {
    let m = manager();
    c.bench_function("mappings", |b| b.iter(|| black_box(m.mappings())));
}

fn bench_ping_all(c: &mut Criterion) {
    let m = manager();
    c.bench_function("ping_all", |b| b.iter(|| black_box(m.ping_all())));
}

criterion_group!(benches, bench_status, bench_matter_qr, bench_mappings, bench_ping_all);
criterion_main!(benches);
