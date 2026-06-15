# ADR-172: RuView Smart Home Ecosystem UI — one control surface for Apple Home, Google Home, Amazon Alexa, and Samsung SmartThings

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-06-14 |
| **Deciders** | ruv |
| **Codename** | **ECO-FABRIC** — a single, branded RuView UI surface that speaks natively to all four major smart-home ecosystems simultaneously |
| **Relates to** | [ADR-115](ADR-115-home-assistant-integration.md) (HA-DISCO MQTT publisher), [ADR-116](ADR-116-cog-ha-matter-seed.md) (cog-ha-matter), [ADR-125](ADR-125-ruview-apple-home-native-hap-bridge.md) (Apple Home native HAP bridge / APPLE-FABRIC), [ADR-126](ADR-126-ruview-native-ha-port-master.md)..134 (HOMECORE), [ADR-161](ADR-161-homecore-server-layer-security.md) (HOMECORE server security) |
| **Tracking issue** | TBD |

---

> **Implementation status (2026-06-15).** ECO-FABRIC is implemented. The backend domain lives in a new `homecore-ecosystems` crate (the `EcosystemsManager`, the §2.5 fail-closed class-2 privacy floor with TOML Seed-config persistence, the entity→primitive mapping table, ping-all, and the Matter manual-code reuse from `wifi_densepose_sensing_server::matter`). The `/api/v1/ecosystems/` REST namespace (§2.3) is wired into `homecore-api` behind the ADR-161 `BearerAuth` gate and fires `ecosystem_status_changed` on the HOMECORE bus; both server bins inject the manager from `RUVIEW_SEED_CONFIG`, and `homecore-server` static-serves the UI bundle at `/ecosystems`. The desktop React/TSX **Ecosystems** page (§2.6 components + `useEcosystems` WS-with-polling-fallback hook) is built and tested. **P1 (read-only status) and P2 (mapping + privacy toggles) are fully live.** **P3 (pairing flows)** is implemented behind the §2.1 degradation contract: the routes exist and are gate-aware — with the `apple-live` / `matter-live` cargo features OFF (default), `apple/pair` returns 409 `hap_server_disabled` and `matter/commission` returns 409 `matter_sdk_unavailable`; the live HAP path closes when `apple-live` is built (verified: pairing returns 200 and the card flips to `paired`), and the live Matter path lands with the rs-matter SDK in v0.7.1. **P4 (longitudinal health) is implemented:** the manager keeps a bounded per-ecosystem ring buffer of health samples (recorded on every `ping_all`), `GET /api/v1/ecosystems/health?window_hours=` returns a windowed per-ecosystem latency series + delivery/error rate + Matter fabric re-commissioning alert count, and the UI renders an `EcosystemHealthPanel` (inline SVG latency sparkline + error rate + alerts); the §4 P4 acceptance (a 1-hour simulated run populating the chart for ≥2 ecosystems) is covered by a unit test. Tests: **30** (crate) + **14** (API integration) + **15** (UI vitest), 0 failed; a live end-to-end smoke of all §4 acceptance commands (status/qr/pair/commission/privacy/ping-all/health) passes, including Seed-config persistence and the `apple-live` gate closing; Python deterministic proof unchanged (PASS).

## 1. Context

### 1.1 The problem this ADR solves

RuView produces sensing signals that a consumer smart-home ecosystem can consume: presence, occupancy, breathing, fall risk, and a family of semantic events. Over the last year the project built a separate integration path into each ecosystem, one ADR at a time, and each path landed as a CLI flag, an environment variable, or a Cognitum-Seed cog with no shared operator surface. ADR-115 shipped an MQTT auto-discovery publisher for Home Assistant. ADR-116 packaged that publisher as a Seed cog and reserved the Matter bridge for a later release. ADR-125 added a native HomeKit Accessory Protocol (HAP) bridge so RuView appears directly in Apple Home with no Home-Assistant middle layer. ADR-126 through ADR-134 (HOMECORE) port the Home-Assistant hub contract to Rust and give RuView a first-class REST and WebSocket API.

The capability is real but the operator experience is not. To onboard a single RuView Seed into the four major consumer ecosystems today, an operator opens four vendor apps (the Apple Home app, the Google Home app, the Amazon Alexa app, and the Samsung SmartThings app), copies setup codes out of container logs, runs CLI subcommands to start the HAP advertiser and the Matter publisher, and edits a configuration file by hand to control which signals leave the node. Nothing shows the operator, in one place, whether each ecosystem is paired, healthy, and receiving events. There is no way to confirm that a test event actually reached all four. There is no way to expose richer data to a trusted local hub while keeping only anonymous presence on a cloud ecosystem without editing config and restarting.

ECO-FABRIC closes that gap. It is a single RuView UI surface — one screen — from which an operator pairs, maps, tests, and privacy-gates RuView's sensors across Apple Home, Google Home, Amazon Alexa, and Samsung SmartThings, without leaving the RuView UI and without a single CLI command once the feature is fully shipped.

### 1.2 What already exists to build on

The scaffolding for three of the four ecosystems is already in the tree, which is what makes this ADR a UI-and-API integration rather than a from-scratch protocol effort. The Apple Home path lives in `v2/crates/homecore-hap/` (`bridge.rs`, `accessory.rs`, `mdns.rs`, `mapping.rs`); its `Cargo.toml` carries a `hap-server` feature flag that gates the live HAP-1.1 server and the real `mdns-sd` integration, with P1 shipping a `NullAdvertiser` stub so the bridge compiles and the entity-to-characteristic mapping is testable without network infrastructure. The Matter path — shared by Google Home, Alexa, and SmartThings — lives in `v2/crates/wifi-densepose-sensing-server/src/matter/` (`mod.rs`, `clusters.rs`, `commissioning.rs`, `bridge.rs`); it owns the cluster and device-type mappings and the 11-digit manual pairing-code generator independent of any Matter SDK, and its module header is explicit that the actual SDK wiring (rs-matter or chip-tool FFI) is deferred to P7 → P8 in v0.7.1 once a pairing spike validates the SDK choice. The HOMECORE server (ADR-130) gives a REST and WebSocket API, and ADR-161 hardened that API's trust boundary by gating every route — including `GET /api/` — behind the `BearerAuth` token whitelist and by fixing a WebSocket authentication bypass. ECO-FABRIC builds on those crates and inherits their auth model unchanged.

### 1.3 Where each ecosystem stands

The four ecosystems converge on two wire protocols, which keeps the surface area small. Apple Home is reached over HAP-1.1; the other three are reached over Matter 1.4, each as its own fabric. The honest state of each path differs and the UI must reflect it rather than paper over it.

| Ecosystem | Wire protocol | Scaffolding | Live today | Gated behind |
|-----------|---------------|-------------|------------|--------------|
| Apple Home | HAP-1.1 over mDNS/Bonjour | `homecore-hap` (bridge/accessory/mdns/mapping) | Mapping + bridge API; mDNS + pairing are stubbed | `hap-server` feature flag (P2 of ADR-125) |
| Google Home | Matter 1.4 over Thread/Wi-Fi | `matter/` (clusters/commissioning/bridge) | Cluster map + manual setup-code generation | rs-matter / chip-tool FFI, v0.7.1 (P7→P8) |
| Amazon Alexa | Matter 1.4 (separate fabric) | shares `matter/` | same as Google Home | same Matter SDK gate |
| Samsung SmartThings | Matter 1.4 (separate fabric) | shares `matter/` | same as Google Home | same Matter SDK gate |

The strategic framing is the same asymmetry ADR-125 drew for Apple Home, now generalised to four ecosystems. RuView contributes a passive RF sensing layer none of the four can produce on their own; the ecosystems contribute the distribution, the consumer trust, and the automation and voice surfaces that an open sensing stack cannot bootstrap. A single control surface that speaks to all four at once is the operator-facing expression of that asymmetry — it makes RuView's sensing addressable to every consumer hub without forcing the operator to learn four vendor apps.

### 1.4 What "fully functional" means here

The decision below defines a production UI, not a demo. A fully functional ECO-FABRIC surface lets an operator pair and manage RuView's presence, vitals, and semantic-event sensors across all four ecosystems from one screen; see live per-ecosystem pairing status (paired, unpaired, or error) with per-ecosystem icons and health indicators; view and edit the table that maps each RuView sensor entity onto the correct primitive in each ecosystem's data model; trigger a test event and confirm its delivery across all four with a single "ping all"; and toggle the privacy class exposed to each ecosystem independently, so a trusted local Home Assistant or Apple Home install can receive more granular data while Google Home and Alexa receive only anonymous presence. The phases in §2.5 stage these capabilities from a read-only dashboard up to full onboarding.

---

## 2. Decision

Ship **ECO-FABRIC**: a unified RuView control surface, served by the HOMECORE server and embedded in the RuView desktop app, that pairs, maps, tests, and privacy-gates RuView sensors across Apple Home (HAP-1.1), Google Home, Amazon Alexa, and Samsung SmartThings (Matter 1.4, three distinct fabrics). The UI is backed by a new family of HOMECORE-API endpoints under `/api/v1/ecosystems/`, every one of which sits behind the same `BearerAuth` token whitelist ADR-161 fixed. The UI never invents capability: where a path is scaffolding-only (the Matter SDK until v0.7.1, the HAP server until the `hap-server` flag is on), the surface says so plainly and disables the corresponding write action rather than pretending it works.

### 2.1 Per-ecosystem integration

#### 2.1.a Apple Home (HAP-1.1)

Apple Home is reached over HAP-1.1 advertised on the local network via mDNS/Bonjour, exactly as ADR-125 specified and as scaffolded in `homecore-hap`. The flow direction is the one ADR-125 §1.1 made explicit: RuView never opens a socket to a HomePod; it advertises an `_hap._tcp` service and the HomePod or Apple TV discovers it. ECO-FABRIC surfaces the HAP setup QR code and the eight-digit setup PIN (formatted `XXX-XX-XXX`, the format carried in `HapServiceRecord::setup_code`), shows the live mDNS advertisement status read from `mdns.rs`, and provides a "re-pair" button that retracts and re-advertises the service so an operator can recover a stuck pairing. Because the live HAP server and the real `mdns-sd` advertiser are gated behind the `hap-server` feature flag in `homecore-hap/Cargo.toml`, the Apple Home card must surface whether that flag is active in the running binary; when it is absent the card renders the mapping and the (stub) status but disables the pair and re-pair actions with an explanatory note.

The characteristic mapping follows `homecore-hap/src/mapping.rs` and the semantic-event contract decided in ADR-125 §2.1.d. The base sensors map a `MotionSensor`'s `MotionDetected` to RuView presence, an `OccupancySensor`'s `OccupancyDetected` to occupancy, and a `TemperatureSensor`'s `CurrentTemperature` to `ambient_temp_c`. The semantic events map as named, thresholded primitives rather than raw probabilities: `Unknown Presence` to a stateful `MotionSensor`, `Unexpected Occupancy` to a programmable `OccupancySensor`, and `Unrecognized Activity Pattern` to a stateful momentary `Switch`. The continuous `identity_risk_score`, the Soul-Signature match probability, and any `rf_signature_hash` never cross the HAP boundary — that invariant is restated here exactly as ADR-125 §2.1.d fixed it, and the mapping table the UI renders is read-only for those internal-only fields.

| RuView entity | HAP service → characteristic | Source |
|---------------|------------------------------|--------|
| presence | `MotionSensor` → `MotionDetected` | `mapping.rs` |
| occupancy | `OccupancySensor` → `OccupancyDetected` | `mapping.rs` |
| ambient_temp_c | `TemperatureSensor` → `CurrentTemperature` | `mapping.rs` |
| Unknown Presence | `MotionSensor` (stateful, programmable) | ADR-125 §2.1.d |
| Unexpected Occupancy | `OccupancySensor` (programmable) | ADR-125 §2.1.d |
| Unrecognized Activity Pattern | `Switch` (stateful, momentary) | ADR-125 §2.1.d |
| identity_risk_score / rf_signature_hash | *never exposed* | ADR-118 §2.5 / ADR-125 §2.1.d |

#### 2.1.b Google Home (Matter 1.4)

Google Home is reached over Matter 1.4 carried on Thread or Wi-Fi. RuView advertises a Matter accessory and the Google Home app scans the QR code or accepts the 11-digit manual code. The scaffolding lives in `matter/` (`mod.rs`, `clusters.rs`, `commissioning.rs`, `bridge.rs`). The UI shows the Matter QR code and the 11-digit manual pairing code generated by `commissioning.rs` (which today emits the manual code per Matter Core Spec 1.3 §5.1.4.1.1, with the `MT:`-prefixed QR string generation itself being a v0.7.1 follow-up), the fabric ID once the accessory is commissioned into the Google fabric, and the commissioning logs streamed line by line so an operator can watch a pairing succeed or diagnose one that fails.

The cluster mapping follows `clusters.rs`. Presence and zone occupancy map to the `OccupancySensing` cluster (`0x0406`) on an `OccupancySensor` device type (`0x0107`); the vendor-extension `n_persons` attribute (`VENDOR_ATTR_PERSON_COUNT`, `0xFFF1_0001`, per ADR-115 §3.11.1) rides on the same occupancy endpoint; the problem-state booleans and the elevated-fall-risk signal use `BooleanState` (`0x0045`) so a controller wiring a motion-light scene does not fire on a distress or fall-risk event; and the fall, bed-exit, and multi-room transitions fire as `GenericSwitch` (`0x000F`) multi-press-complete events. Heart rate, breathing rate, and pose keypoints have no Matter cluster and are deliberately not exposed over Matter, which the UI shows as an explicit "MQTT-only" row rather than an empty cell.

The pending SDK wiring is the load-bearing honesty point for this ecosystem. The `matter/mod.rs` header states that the rs-matter / chip-tool FFI lands in v0.7.1; until that gate closes there is no live commissioning. The Google Home card must therefore render the QR and manual code from `commissioning.rs` (which is real and testable) but display the banner **"Matter SDK: scaffolding only — full commissioning in v0.7.1"** and disable the commission action whenever the Matter SDK feature is absent in the running binary. It must not present a fake "commissioned" state.

| RuView entity | Matter cluster → device type | Notes |
|---------------|------------------------------|-------|
| presence / zone occupancy | `OccupancySensing` (0x0406) → `OccupancySensor` (0x0107) | spec attribute read |
| person count (`n_persons`) | `OccupancySensing` (0x0406), vendor attr `0xFFF1_0001` | shares occupancy endpoint; §3.11.1 |
| fall risk (elevated) | `BooleanState` (0x0045) | not occupancy — keeps it out of motion-light scenes |
| fall / bed-exit / multi-room | `GenericSwitch` (0x000F) | `MultiPressComplete` event (0x06) |
| heart rate / breathing / pose | *no Matter cluster* | MQTT-only, shown explicitly |

#### 2.1.c Amazon Alexa (Matter 1.4, separate fabric)

Alexa has supported Matter natively since late 2023, so the recommended and primary integration path is the same Matter 1.4 commissioning flow as Google Home — but commissioned into a **separate fabric**. A Matter accessory can be commissioned into several fabrics at once, each with its own Node Operational Certificate chain (see §3.3), so the UI shows Alexa fabric status as a distinct card from Google Home fabric status; the two are independently paired, healthy, or errored. The capability mapping mirrors §2.1.b in Alexa's vocabulary: `Alexa.MotionSensor` to presence, `Alexa.OccupancySensor` to occupancy, `Alexa.TemperatureSensor` to ambient temperature, and `Alexa.ContactSensor` used as the fall-risk gate.

A secondary path exists for operators who cannot run Matter at all: an Alexa Smart Home Skill backed by an AWS Lambda function. This ADR documents it as a fallback only and recommends Matter-first, because the skill path requires cloud account linking, an externally reachable Lambda endpoint, and Amazon developer-console configuration that defeats the local-first, zero-CLI goal of ECO-FABRIC. The UI exposes the skill path behind an "advanced / cloud fallback" disclosure on the Alexa card and does not present it as the default.

#### 2.1.d Samsung SmartThings (Matter 1.4, separate fabric)

SmartThings has supported Matter commissioning since 2023, so its primary path is again Matter 1.4 — a **third fabric**, distinct from both Google Home and Alexa. The UI shows the SmartThings Device ID once the accessory is commissioned and renders the same capability mapping table. The fallback path for SmartThings is the SmartThings Schema Connector (cloud-to-cloud), intended for operators behind strict NAT where local Matter mDNS multicast is blocked; on that path the UI shows the webhook endpoint status. Matter-first is preferred and the cloud-to-cloud connector is presented as the fallback, behind the same advanced disclosure used for Alexa's skill path.

#### 2.1.e Summary of pairing mechanics

| Ecosystem | Primary path | Fallback path | UI artifacts surfaced |
|-----------|--------------|---------------|------------------------|
| Apple Home | HAP-1.1 / mDNS | — | setup QR + PIN, mDNS status, re-pair |
| Google Home | Matter 1.4 fabric A | — | Matter QR + 11-digit code, fabric ID, commissioning log |
| Amazon Alexa | Matter 1.4 fabric B | Alexa Smart Home Skill + Lambda | fabric status (distinct), QR + code |
| Samsung SmartThings | Matter 1.4 fabric C | Schema Connector (cloud-to-cloud) | Device ID, webhook status, mapping |

### 2.2 Frontend framework and location (decided)

Three placements were considered. Option (a) extends the existing HOMECORE frontend; option (b) creates a new standalone crate `v2/crates/homecore-ecosystems-ui/`; option (c) adds a new page to the existing RuView desktop app (the ADR-054 Tauri shell, whose UI is a React + TSX tree under `v2/crates/wifi-densepose-desktop/ui/src/` built with Vite, alongside the HOMECORE example frontend's `Outfit` + `JetBrains Mono` design tokens).

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| (a) extend HOMECORE frontend | endpoints already live on HOMECORE-API; inherits ADR-161 auth for free | example frontend is vanilla-TS/Lit, not React | partly adopted (serving path) |
| (b) new `homecore-ecosystems-ui` crate | clean isolation | duplicates a component library, a build, and a bundle; second auth integration to keep in sync with ADR-161; violates "prefer editing an existing surface" | **rejected** |
| (c) new page in desktop app | reuses the React + TSX + Vite + Tauri stack and component conventions (`NodeCard`, `StatusBadge`, `Sidebar`, the `Sensing`/`Settings` pages) | desktop app is one of two front-ends RuView ships | **adopted (component home)** |

The decision is a hybrid of (a) and (c) that rejects (b). The ECO-FABRIC components are built as a new `ecosystems/` feature module inside the existing React + TSX desktop UI tree, reusing its Vite build, its `Outfit` display / `JetBrains Mono` mono fonts, and its `StatusBadge`-style conventions, so RuView ships one component library and one design system rather than two. The compiled bundle is served in two places from the same source: inside the Tauri desktop app as a new page, and by the HOMECORE server as a static route at `/ecosystems`. Both front-ends reach the data only through the HOMECORE-API `/api/v1/ecosystems/` endpoints, so the surface inherits ADR-161's `BearerAuth` gate directly and a standalone crate's parallel auth integration is avoided. This decision does not contradict ADR-161's HOMECORE API auth requirements; it depends on them.

### 2.3 Backend API surface

ECO-FABRIC adds one REST namespace and reuses the existing HOMECORE WebSocket for live state. Every route below is registered behind `BearerAuth::from_headers` → `LongLivedTokenStore::is_valid` exactly as the seven hardened REST handlers and the WS handshake are after ADR-161; a missing or wrong bearer returns `401` and none of these routes is reachable unauthenticated. The namespace is reviewed under the same threat model ADR-161 applied to `GET /api/` and the WS path (see §3.4).

```text
GET  /api/v1/ecosystems/status            → snapshot of all four ecosystems
GET  /api/v1/ecosystems/matter/qr         → Matter QR string + 11-digit manual code
POST /api/v1/ecosystems/apple/pair        → start HAP advertisement (needs hap-server)
POST /api/v1/ecosystems/apple/repair      → retract + re-advertise HAP service
POST /api/v1/ecosystems/matter/commission → commission into one Matter fabric (needs SDK, v0.7.1)
GET  /api/v1/ecosystems/mappings          → current entity→primitive mapping table
PUT  /api/v1/ecosystems/mappings          → update a mapping row (persists to Seed config)
PUT  /api/v1/ecosystems/{eco}/privacy     → set per-ecosystem privacy-class override
POST /api/v1/ecosystems/ping-all          → emit a synthetic test event to every paired ecosystem
```

The `status` response is the single source of truth the dashboard renders. Each ecosystem reports a pairing state, a health indicator, the feature-flag availability that gates its live path, and ecosystem-specific identifiers.

```jsonc
// GET /api/v1/ecosystems/status  → 200
{
  "ecosystems": [
    {
      "id": "apple_home",
      "protocol": "hap-1.1",
      "pairing": "paired",                 // paired | unpaired | error
      "health": "ok",                      // ok | degraded | down
      "feature_available": true,           // hap-server flag on?
      "privacy_class": 2,                  // effective class for this ecosystem
      "details": { "mdns_advertised": true, "setup_pin": "031-45-154",
                   "accessory_count": 6 }
    },
    {
      "id": "google_home",
      "protocol": "matter-1.4",
      "pairing": "unpaired",
      "health": "ok",
      "feature_available": false,          // Matter SDK not wired until v0.7.1
      "privacy_class": 3,
      "details": { "fabric_id": null, "sdk_status": "scaffolding-only" }
    },
    { "id": "amazon_alexa",      "protocol": "matter-1.4", "pairing": "unpaired",
      "health": "ok", "feature_available": false, "privacy_class": 3,
      "details": { "fabric_id": null, "fallback": "smart-home-skill" } },
    { "id": "smartthings",       "protocol": "matter-1.4", "pairing": "unpaired",
      "health": "ok", "feature_available": false, "privacy_class": 3,
      "details": { "device_id": null, "fallback": "schema-connector",
                   "webhook_ok": null } }
  ]
}
```

```jsonc
// GET /api/v1/ecosystems/matter/qr  → 200
{ "qr_payload": "MT:Y.K9042C00KA0648G00",   // null until QR generation lands (v0.7.1)
  "manual_code": "34970112332",             // real today, from commissioning.rs
  "discriminator": 3840, "vendor_id": 65521, "product_id": 32769 }

// POST /api/v1/ecosystems/matter/commission  { "ecosystem": "google_home" }
//   → 200 { "fabric_id": "0xFAB1...", "node_id": "0x...", "status": "commissioned" }
//   → 409 { "error": "matter_sdk_unavailable",
//           "message": "Matter commissioning unavailable until v0.7.1" }

// POST /api/v1/ecosystems/apple/pair  → 200 { "mdns_advertised": true,
//           "setup_pin": "031-45-154", "qr_uri": "X-HM://..." }
//   → 409 { "error": "hap_server_disabled",
//           "message": "homecore-hap built without the hap-server feature" }

// PUT /api/v1/ecosystems/google_home/privacy  { "privacy_class": 3 }
//   → 200 { "ecosystem": "google_home", "privacy_class": 3, "applied": true }
//   → 422 { "error": "class_below_floor",
//           "message": "consumer ecosystems may not drop below class 2 (anonymous)" }

// POST /api/v1/ecosystems/ping-all  → 200
//   { "results": [ { "ecosystem": "apple_home", "delivered": true,  "latency_ms": 180 },
//                  { "ecosystem": "google_home","delivered": false, "reason": "unpaired" } ] }
```

### 2.4 State management (decided)

The dashboard must reflect four live, independently-changing pairing states without the operator refreshing. Three patterns were weighed: short-interval polling of `GET /status`, an SSE stream, and a subscription over the existing HOMECORE WebSocket. The decision is to subscribe over the HOMECORE WebSocket, because that socket already exists, already carries the event bus, and was hardened by ADR-161 (the auth bypass and the reply-theater fixes mean a WS subscription is now both authenticated and actually delivered, and a broadcast lag no longer silently kills the stream). ECO-FABRIC publishes `ecosystem_status_changed` events onto the same bus; the UI subscribes once on mount and renders deltas. A plain `GET /api/v1/ecosystems/status` is used only for the initial load and as a manual "refresh" fallback for environments where the WebSocket cannot be established. Polling-as-primary was rejected because four ecosystems times a sub-second poll is wasteful and still laggy; SSE was rejected because it would add a second server-push transport when the WebSocket already does the job and already carries the ADR-161 security guarantees.

### 2.5 Privacy class per-ecosystem toggle (decided)

RuView's privacy model (ADR-120) defines four classes: 0 `raw` (local research only, never networked), 1 `derived` (operator-acknowledged research over LAN), 2 `anonymous` (the production default: aggregate presence, motion, person count, zone, confidence), and 3 `restricted` (class 2 minus `identity_risk_score` and `rf_signature_hash`, for care-home and regulated deployments). Today an operator sets one global class through `RUVIEW_BFLD_PRIVACY_CLASS`. ECO-FABRIC introduces a per-ecosystem override so an operator can expose class 2 to a trusted local Home Assistant or Apple Home install while keeping Google Home and Alexa at class 3 — more granular data locally, anonymous presence only to the cloud ecosystems.

The override is a fail-closed floor, never a promotion. A consumer ecosystem may be set to class 2 or class 3 only; the UI toggle offers exactly those two values (labelled "Anonymous" and "Restricted") and the API rejects any attempt to drop a networked ecosystem to class 1 or 0 with `422 class_below_floor`. This preserves invariant I1 from ADR-120 (raw BFI never exits the node) and the structural rule that the four-ecosystem boundary is, at most, a class-2 boundary. The configuration data model is an `ecosystem_privacy_overrides` map persisted in the Seed config file; the global `RUVIEW_BFLD_PRIVACY_CLASS` remains the default for any ecosystem without an explicit override.

```toml
# Seed config — ecosystem privacy overrides (ADR-172 §2.5)
[bfld]
privacy_class = 2                       # global default (RUVIEW_BFLD_PRIVACY_CLASS)

[ecosystems.privacy_overrides]
apple_home  = 2                         # Anonymous — trusted local hub
google_home = 3                         # Restricted — cloud ecosystem
amazon_alexa = 3                        # Restricted — cloud ecosystem
smartthings = 3                         # Restricted — cloud ecosystem
```

The flow from UI to running crates is: the `PrivacyClassToggle` issues `PUT /api/v1/ecosystems/{eco}/privacy`; the HOMECORE handler validates the floor, writes the `ecosystem_privacy_overrides` entry to the Seed config, and pushes the new effective class into the per-ecosystem sink so the next characteristic update (HAP) or attribute report (Matter) for that ecosystem is filtered at the new class. The change is reflected within the same five-second window the entity-mapping acceptance criterion uses (§2.5 / P2 acceptance).

### 2.6 Component breakdown

The React + TSX components below live in the `ecosystems/` feature module and follow the existing desktop UI's conventions. Each is described by its props and the state it owns.

```tsx
// <EcosystemsDashboard> — container; owns the WS subscription and the status array.
//   state:  EcosystemStatus[] (seeded by GET /status, updated by WS deltas)
//   render: a 2×2 grid of <EcosystemCard>, a <PingAllButton>, an <EntityMappingTable>.

// <EcosystemCard ecosystem={EcosystemStatus} onPair onRepair onCommission />
//   props:  one ecosystem's status row.
//   state:  local "action in flight" boolean.
//   render: vendor icon, pairing badge (paired/unpaired/error), health dot,
//           a <PrivacyClassToggle>, and — for Matter cards without the SDK —
//           the "scaffolding only — v0.7.1" banner with disabled actions.

// <PairingQRCode kind={'hap'|'matter'} payload manualCode pin />
//   props:  QR string (may be null), manual/PIN fallback text.
//   render: the QR image, or, when payload is null, the manual code + a note.

// <EntityMappingTable rows={MappingRow[]} editable onEdit />
//   props:  the entity→primitive rows across all four ecosystems.
//   state:  per-row draft + dirty flag.
//   render: editable per-ecosystem mapping; internal-only rows
//           (identity_risk_score) are shown read-only and greyed.

// <PrivacyClassToggle ecosystem value={2|3} onChange />
//   props:  current effective class.
//   render: an Anonymous|Restricted segmented control; PUTs on change,
//           shows the 422 floor error inline if rejected.

// <PingAllButton onPing results={PingResult[]} />
//   state:  in-flight + last results.
//   render: a button that POSTs /ping-all and shows per-ecosystem
//           delivered/latency or the failure reason.

// <MatterCommissioningLog lines={string[]} />
//   props:  streamed commissioning log lines (over the WS).
//   render: an autoscrolling monospace (JetBrains Mono) log pane.
```

---

## 3. Consequences

### 3.1 Wins

The primary win is operator experience, and it is quantifiable. Today, onboarding one RuView Seed into all four ecosystems requires four native vendor apps and at least one CLI session to start the HAP advertiser and the Matter publisher and to hand-edit the privacy configuration. With ECO-FABRIC at P3, the operator needs one UI and zero CLI commands: pairing, mapping, privacy gating, and delivery testing all happen on one screen. That is the headline user-experience result and the reason the four-ecosystem surface is worth building as one thing rather than four. The secondary wins follow from consolidation: a single status surface means an operator can see at a glance which ecosystems are healthy and which are not, the "ping all" function turns "did my event arrive?" from a four-app investigation into one click, and the per-ecosystem privacy toggle makes the local-versus-cloud data-exposure decision a deliberate, visible choice rather than a buried global flag.

### 3.2 Costs

ECO-FABRIC depends on protocol scaffolding that is not yet live, so a portion of the surface ships in a visibly-degraded state until v0.7.1. The Apple Home write path depends on the `hap-server` feature being compiled in; the three Matter ecosystems depend on the rs-matter / chip-tool FFI that lands in v0.7.1. Until those gates close, the read-only dashboard and the mapping and privacy surfaces (P1, P2) are fully functional, but the pairing actions (P3) are disabled with explanatory banners. This is a cost in the sense that the feature is not "done" on day one, but it is a deliberate one: the alternative — a UI that appears to commission a Matter fabric while no SDK exists behind it — is the documented-but-no-op failure mode ADR-161 was written to eliminate, and ECO-FABRIC must not reintroduce it. A smaller cost is the dual serving path (Tauri page plus HOMECORE static route) from one bundle, which adds a build target but not a second codebase.

### 3.3 Risks

**Matter SDK immaturity.** The rs-matter crate and the chip-tool FFI are not yet stable, and the `matter/mod.rs` header is explicit that the SDK wiring is deferred to v0.7.1. The mitigation is the degradation contract in §2.1.b: the UI renders the QR and manual code from `commissioning.rs` (which is real and spec-correct today) but shows "Matter commissioning unavailable until v0.7.1" and disables the commission action whenever the SDK feature is absent. The UI must fail visibly, never silently.

**Multi-fabric key management.** Three separate Matter fabrics — Google Home, Alexa, and SmartThings — require three separate Node Operational Certificate (NOC) chains, each rooted in a Certificate Authority. The decision is to provision a **local CA** owned by the Seed rather than relying on the chip-tool development CA, because a development CA is unsuitable for a production deployment and because RuView already owns a key-management pattern that fits: the Ed25519 witness chain from ADR-116 (`witness.rs` / `witness_signing.rs`), which uses domain-separated, length-prefixed signing with `verify_strict` and stores production keys in the Seed secure store rather than generating or logging them in-crate. The NOC chains are stored under the same secure-store discipline — the Seed's local CA signs each fabric's NOC, the private keys never touch the wire or disk in plaintext, and each fabric's chain is independent so compromising or re-commissioning one fabric does not affect the others. The detailed NOC issuance and rotation procedure is deferred to the v0.7.1 SDK-wiring work (it cannot be finalised before the SDK is chosen), and is flagged as an open question in §5.

**HAP pairing-state persistence.** ADR-125 §3.2 already flagged that HAP pairing state must survive a container restart, persisted under `/var/lib/ruview-hap/`. ECO-FABRIC inherits that requirement and must address it in the UI's restart and recovery flow: after a restart the Apple Home card reads back the persisted pairing rather than presenting an unpaired state, and the re-pair button is the explicit operator escape hatch when persistence is lost.

**HOMECORE auth.** ADR-161 fixed a WebSocket authentication bypass and an unauthenticated `GET /api/`. Every new `/api/v1/ecosystems/` route and the `ecosystem_status_changed` WS subscription must be reviewed under that same threat model: each REST route gates on `BearerAuth::from_headers` → `LongLivedTokenStore::is_valid` before any work, the WS subscription is unreachable before `auth_ok`, and no route returns ecosystem state to an unauthenticated caller. The pairing endpoints are privileged (they start network advertisements and commission fabrics) and must be treated as at least as sensitive as the existing service-call routes.

### 3.4 Reversibility

ECO-FABRIC is additive. The `/api/v1/ecosystems/` namespace is a new route group that can be removed without touching the existing HOMECORE handlers; the desktop page is a new feature module that can be unmounted; the per-ecosystem privacy overrides degrade to the global `RUVIEW_BFLD_PRIVACY_CLASS` if the override map is removed. The underlying `homecore-hap` and `matter/` crates are unchanged by this ADR — ECO-FABRIC consumes their existing surfaces. Pulling the feature out leaves the four integration paths exactly as ADR-115, ADR-116, and ADR-125 left them.

---

## 4. Acceptance test

The phases below stage from a read-only dashboard to full onboarding, following the P1/P2/P3 pattern of ADR-125 §2.3. Each phase has an explicit acceptance gate.

**P1 — Read-only status dashboard.** Shows the current pairing state for all four ecosystems, live health indicators, and the Matter QR/PIN codes, with no write operations. Acceptance: all four `<EcosystemCard>`s render correctly whether the ecosystem is paired or not; the Matter QR/manual code renders from `commissioning.rs` output; the Apple Home mDNS status reads from `mdns.rs`; a Matter card with no SDK shows the "scaffolding only — v0.7.1" banner.

**P2 — Entity mapping table and privacy toggles.** Editable per-ecosystem sensor-to-primitive mapping and per-ecosystem privacy-class override, persisted to the Seed config. Acceptance: changing a mapping in the UI is reflected in the next HAP characteristic update or Matter attribute report within five seconds; setting `google_home` to Restricted writes the `ecosystem_privacy_overrides` entry and filters that ecosystem's next report at class 3; an attempt to set a networked ecosystem below class 2 is rejected with `422`.

**P3 — Full pairing flows.** HAP pair and re-pair, Matter commission for Google Home / Alexa / SmartThings (each its own fabric, when the rs-matter SDK is wired), and the ping-all function. Acceptance: a fresh Seed can be fully onboarded to all four ecosystems from the UI with zero CLI commands; ping-all reports per-ecosystem delivery for every paired ecosystem.

**P4 — Longitudinal ecosystem health.** A per-ecosystem event-delivery-latency chart over the last 24 hours, a retry/error rate, and Matter fabric re-commissioning alerts. Acceptance: a one-hour simulated run produces a populated chart for at least two ecosystems.

```bash
# P1 acceptance — read-only dashboard against a HOMECORE server with a token.
TOKEN=$(cat /var/lib/homecore/token)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8123/api/v1/ecosystems/status | jq '.ecosystems[].pairing'
# expect: four pairing states; google/alexa/smartthings show feature_available=false

# unauthenticated request is rejected (ADR-161 threat model)
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:8123/api/v1/ecosystems/status      # expect: 401

# P2 acceptance — set Google Home to Restricted; floor rejection on class 1.
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -d '{"privacy_class":3}' http://127.0.0.1:8123/api/v1/ecosystems/google_home/privacy
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -d '{"privacy_class":1}' http://127.0.0.1:8123/api/v1/ecosystems/google_home/privacy
# expect: first 200 applied; second 422 class_below_floor

# P3 acceptance — ping all paired ecosystems.
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8123/api/v1/ecosystems/ping-all | jq '.results'
```

---

## 5. Open questions

The NOC issuance and rotation procedure for the three Matter fabrics is deferred to the v0.7.1 SDK-wiring work, because the certificate-provisioning API depends on the SDK choice (rs-matter versus chip-tool FFI). This ADR commits to a Seed-owned local CA stored under the ADR-116 secure-store discipline; the per-fabric issuance, the re-commissioning trigger, and the rotation cadence are to be settled when the SDK lands.

Whether the Matter QR payload should be generated on the Seed (the `MT:`-prefixed base-38 string, currently a v0.7.1 follow-up in `commissioning.rs`) or whether the manual 11-digit code alone is sufficient for the four target controllers is unresolved; the manual code works in all four apps today, and QR generation is a UX nicety that can follow.

Whether the desktop Tauri page and the HOMECORE-served `/ecosystems` route should share a single live WebSocket connection or maintain independent subscriptions when both are open against the same Seed is a minor connection-management question to settle during P1.

Whether ECO-FABRIC should surface the Alexa Smart Home Skill and the SmartThings Schema Connector fallbacks as first-class cards or keep them behind the advanced disclosure is a product decision that operator feedback after P3 should inform; the default decided here is the advanced disclosure, Matter-first.

---

## 6. References

- [ADR-115](ADR-115-home-assistant-integration.md) — Home Assistant via MQTT auto-discovery + Matter bridge (HA-DISCO)
- [ADR-116](ADR-116-cog-ha-matter-seed.md) — HA + Matter as a Cognitum Seed cog (`cog-ha-matter`); Ed25519 witness chain key-management pattern (§4.1)
- [ADR-125](ADR-125-ruview-apple-home-native-hap-bridge.md) — RuView ↔ Apple Home native HAP bridge (APPLE-FABRIC); semantic-event mapping (§2.1.d), pairing-state persistence (§3.2)
- [ADR-126](ADR-126-ruview-native-ha-port-master.md) — HOMECORE master ADR (native Rust + WASM + TS port of Home Assistant)
- [ADR-161](ADR-161-homecore-server-layer-security.md) — HOMECORE server-layer security (WS auth-gate, `GET /api/` auth-gate, reply-theater fixes)
- HomeKit Accessory Protocol Specification (Non-Commercial Version), Apple — https://developer.apple.com/apple-home/
- Matter 1.4 Specification, Connectivity Standards Alliance — https://csa-iot.org/all-solutions/matter/
- `homecore-hap` crate README — `v2/crates/homecore-hap/` (`bridge.rs`, `accessory.rs`, `mdns.rs`, `mapping.rs`; `hap-server` feature flag in `Cargo.toml`)
- `matter/` module source — `v2/crates/wifi-densepose-sensing-server/src/matter/` (`mod.rs`, `clusters.rs`, `commissioning.rs`, `bridge.rs`)
