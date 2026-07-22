# Project Status Board

Single source of truth for **what's done vs not**. Tick items as they land.
Companion docs: [UPDATES.md](UPDATES.md) (history of every change) · [MULTI-TENANT-PLAN.md](MULTI-TENANT-PLAN.md) (rationale + roadmap) · [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) (product roadmap).

Legend: `[x]` done · `[ ]` not started · `[~]` partial (note explains what's left). "Verified" = code checked (node --check + load/schema + builds); live infra runs (Mongo/Redis/MinIO/OpenRouter) are called out where not yet exercised.

_Last updated: 2026-07-22._

---

## A. Multi-tenant hardening waves

- [x] **OpenRouter migration** — LLM provider swapped, keyless fallback kept.
- [x] **Wave 1 — Tenant isolation** — guardrail plugin + tenant context; F1 job-leak, F10 suspension gate, F14 fixes.
- [~] **Wave 2 — Multi-instance safety** — storage abstraction, Socket.io Redis adapter, worker split + atomic cron, env validation, graceful shutdown, readiness. _Left: verify on a real 2-instance run (needs Redis + MinIO)._
- [~] **Wave 3 — LLM safety & cost** — timeout/retry, per-tenant metering + budget cap, detached evaluation, rate limits. _Left: load test; live OpenRouter path._
- [x] **Wave 4 — Compliance & AI governance** — consent capture, human-in-the-loop ATS, bias-blinding, injection defense, provenance, safe fallback.
- [x] **W9 — Admin AI-report review** — endpoint + screen + decision actions.
- [~] **Wave 5 — DPDP & security platform** — ✅ retention job, ✅ erasure + DPDP export + public DPO endpoint, ✅ `AuditLog` + middleware, ✅ rotating refresh tokens + short-lived access (both frontends), ✅ `helmet`/`compression`/JSON limit/request timeouts, ✅ CompanySettings admin UI (tenants now self-serve ai/compliance/dpo/retention — see §C). _Left: encryption-at-rest + secrets manager (infra, §D); optional httpOnly-cookie refresh storage._
- [~] **Wave 6 — Performance & observability** — ✅ compound indexes (F11) matched to hot query paths + redundant single-field indexes dropped + `sync:indexes` reconcile script, ✅ Mongo pool/timeouts + prod `autoIndex` off, ✅ structured JSON logs + `x-request-id` correlation + redaction, ✅ `GET /metrics` (Prometheus: request counter + latency histogram + process gauges, token-guardable), ✅ zero-dep load-test script with SLO gate, ✅ [OBSERVABILITY.md](OBSERVABILITY.md) (SLO + metrics catalog + alert rules). _Left (ops): run the 100-concurrent load test on live infra (§D) + wire Prometheus/Alertmanager to the shipped alert rules._
- [~] **Wave 7 — Proctoring MVP** — ✅ live integrity monitoring during the interview: **Tier 1** browser signals (tab-switch, window-blur, fullscreen-exit, copy/paste, right-click, camera-loss) + **Tier 2** in-browser vision (face presence, multi-face, gaze/head-pose, **identity match** vs the pre-check photo), all feeding a deterministic **server-computed risk score** on the admin report + PDF; **warn-live** enforcement + required consent gate. Vision runs in-browser (raw video never leaves the device) behind a self-hosted, gracefully-degrading face-model seam. _Left: live run in a real browser + `npm run fetch:face-models` to activate Tier 2 (no camera/renderer in this env); dedicated `Violation` collection + stored image evidence; phone/object detection deferred._
- [ ] **Wave 8 — Recording + secondary camera** — SFU (LiveKit/mediasoup) + phone-cam WebRTC + recording to object storage (paid add-on).

## B. Deferred sub-items (inside shipped waves)

- [ ] True per-tenant **concurrency limiter** (Redis token bucket) — W3; budget cap + rate limiting cover pilot.
- [ ] **LLM residency**: pin zero-retention OpenRouter routing + signed DPA — operational config (W4 / plan §6.1).
- [ ] **Tenant guardrail strict mode** — validate with `TENANT_GUARD_STRICT=true` in staging, then keep off in prod (W1).
- [ ] **`$push` for interview turns + context caching** (H2) — nationwide-scale optimization; full-doc save fine at pilot.
- [x] **HTTP hardening**: `helmet`, `compression`, JSON body limit, request/header timeouts (M3) — shipped in W5.
- [~] **Shared rate-limit store** — portal endpoints use Redis/memory limiter (done); the company-auth **OTP limiter still uses in-memory store** (H3) — convert to Redis for multi-instance.

## C. Product features still missing (post-hardening)

- [~] **Voice layer** — ✅ real-time **voice interview** shipped: browser streams mic → Deepgram streaming STT (short-lived server-minted token), spoken questions via Deepgram Aura TTS (backend-proxied), barge-in + live captions + type-to-answer fallback; ✅ **delivery + confidence scoring** from answer prosody (words/min, filler rate, pause ratio, energy variance → deterministic server-side scores) surfaced in the admin report + PDF. Provider is behind a swappable `speechService` seam. _Left: live run with a real `DEEPGRAM_API_KEY` (no key/mic/renderer in this env); V5 hardening — voice consent notice, STT/TTS cost metering, audio retention; residency-safe provider swap (self-hosted Whisper / Sarvam) — Deepgram is the demo choice, audio currently leaves India._
- [ ] **WebSocket + BullMQ interview worker + Redis session state** — 10k-concurrent interview scale (Phase 2 deferred).
- [x] **PDF report** generation — downloadable PDF of the AI interview report (evaluation + transcript) via `GET /api/candidates/:id/interview-report/pdf` + a Download button on the report screen; zero-dep PDF writer (`utils/pdf.js`). _Live PDF-viewer render not yet spot-checked (no renderer in the build env; validated structurally)._
- [ ] **External job-board publishing** — LinkedIn/Indeed/Naukri connectors + publish queue (Phase 5; needs partner API access).
- [ ] **Super Admin** role + cross-company oversight (Phase 6).
- [ ] **Departments** as a first-class model (currently a string on Job) (Phase 6).
- [ ] **Real Reports/Analytics** dashboards (currently thin) (Phase 6).
- [ ] **Cloud storage for recordings** — introduced with W7/W8 (storage abstraction already supports S3/MinIO).
- [x] **CompanySettings admin UI** — `GET`/`PUT /api/company-settings` + an editable Settings screen: tenants now self-serve `ai` (model/budget/temperature/hard-cap), `compliance` (consent/auto-reject/retention days), `dpo` contact, email notifications, and branding. Compliance/DPO/retention edits are audit-logged. _Live save/read round-trip against a running Mongo not yet exercised._

## D. Ops / go-live checklist (not code)

- [ ] Provision **India VPS stack**: Mongo replica set + Redis + MinIO + Caddy/Nginx TLS.
- [ ] **Backups** + tested **restore drill** meeting RPO ≤ 1h / RTO ≤ 4h (plan §0).
- [~] **Load test** at 100 concurrent meets the SLO (plan §0) — pairs with W6. _Code: `npm run loadtest` script + SLO gate shipped (W6). Left: run it at 100-concurrent against live infra from a separate host (k6/vegeta) and confirm the SLO._
- [ ] **Pen-test** + dependency scan.
- [~] **DPO** named + **DPA** signed + data residency configured (all data in India). _Code: per-tenant DPO contact field + public lookup endpoint shipped (W5). Left: actually name a DPO, sign the DPA, host in India._
- [ ] **Runbook**: deploy, rollback, backup/restore, tenant suspend/offboard, incident response.
- [ ] Set production env: `NODE_ENV=production`, `REDIS_URL`, `S3_*`, `RUN_WORKERS_IN_API=false` + run `npm run worker`.

---

### Next recommended step
Waves 1–6 shipped (code), plus the two highest-value product gaps — **CompanySettings admin UI**
and the **PDF interview report** (both §C, done 2026-07-21). The multi-tenant hardening track and
the near-term product backlog are now code-complete for a pilot. What remains before launch is
**ops** (section D): stand up the India VPS stack (Mongo replica set + Redis + MinIO + TLS), run
`npm run sync:indexes`, wire Prometheus/Alertmanager to [OBSERVABILITY.md](OBSERVABILITY.md)'s
rules, run the 100-concurrent load test to confirm the SLO, take backups + do a restore drill,
name a DPO + sign the DPA, and pen-test. After that a real pilot can launch. Remaining **product**
work is larger/optional: Proctoring/recording/voice (W7/W8), external job-board publishing, Super
Admin, and real analytics — all after a safe launch.
