# Multi-Tenant Production Readiness Plan

_A foolproof plan to take hiringAI from a working single-node build to a multi-tenant SaaS a company can operate — starting as a pilot and architected to grow nationwide (India)._

_Derived from a four-lens code audit (tenant-isolation/security, architecture/scale, ML/LLM, computer-vision/proctoring) against the live codebase, 2026-07-20. Companion to `IMPLEMENTATION-PLAN.md`._

> **Live progress tracker: [STATUS.md](STATUS.md)** — checkbox board of what's done vs left across all waves, sub-items, product features, and ops.

---

## 0. Locked decisions (drive every recommendation below)

| Decision | Choice | Consequence |
|---|---|---|
| **Tenancy model** | **Shared database, strict row-scoping** (`company` on every tenant doc) | Cheapest to run, closest to current code. Isolation is *logical* — so the tenant guardrail (§3) is mandatory, not optional. |
| **Scale target (now)** | **Pilot** — < 50 companies, < 100 concurrent interviews | Modest infra, but built **scale-ready** so nationwide is config/replicas, not a rewrite. |
| **Compliance bar** | **India DPDP Act 2023 + data stored in India** | Data residency, consent (incl. biometric), retention, data-principal rights. **Conflicts with the current global LLM router — see §6.** |
| **Hosting** | **Self-hosted VPS (India region)** | Self-managed Mongo/Redis/object-storage/TLS. Use MinIO (not S3), Docker Compose now, k8s later. |

**SLO (pilot targets — the acceptance bar for "production").**

| Metric | Target (pilot) | Nationwide target |
|---|---|---|
| API latency (non-LLM) | p50 < 150 ms · p95 < 400 ms · p99 < 800 ms | p99 < 500 ms |
| AI interview turn (LLM) | p95 < 8 s · p99 < 20 s (hard 30 s timeout) | same |
| Uptime | 99.5% | 99.9% |
| RPO (max data loss) | ≤ 1 h (oplog/PITR); 24 h daily-backup floor | ≤ 15 min |
| RTO (recovery time) | ≤ 4 h | ≤ 1 h |
| Error-budget owner | Engineering lead / founder (named person) | Platform on-call |

---

## 1. Current posture — what the audit found

**Strong (keep, don't touch):**
- `companyId` is derived **only** from the JWT-authenticated, DB-loaded user (`middleware/auth.js`) — never from request body/params. No tenant-id spoofing surface.
- Admin read/write handlers consistently use compound `{ _id, company: req.user.company }` filters (`candidateController.js`, `jobController.js`, billing, queues) → classic cross-tenant IDOR is already closed.
- Interview-portal tokens and Socket.io rooms are tenant-safe by construction (session-bound token; server-derived room names).
- Uploads are **not** statically served — reachable only through authz-checked download handlers with random filenames (no path traversal / enumeration).
- Every tenant collection carries an indexed `company` ref.

**Broken / risky (this plan fixes):**

| # | Severity | Finding | Source |
|---|---|---|---|
| F1 | **HIGH (security)** | `GET /api/jobs/:id` is **unauthenticated and unscoped** — returns any tenant's draft/closed job (description, `atsThreshold`, interview instructions) by guessable slug. | `jobRoutes.js:22`, `jobController.js:20-25` |
| F2 | **CRITICAL (scale)** | Socket.io has **no Redis adapter** → live notifications silently drop across instances (only work when emitter+socket land on same node). | `config/socket.js:16` |
| F3 | **CRITICAL (scale)** | Cron jobs run **in every instance** with read-then-write guards → duplicate reminder/expiry emails at N replicas. | `server.js:83-84`, `jobs/*.js` |
| F4 | **CRITICAL (scale)** | Resumes/photos on **local disk** → invisible to other instances; ATS silently scores **empty text** and downloads 404. | `middleware/upload.js`, `atsService.js:15-19` |
| F5 | **CRITICAL (scale)** | Redis is "optional"; email worker runs **in-process** with the API. | `config/redis.js`, `server.js:82` |
| F6 | **HIGH (scale/cost)** | LLM `fetch` has **no timeout, no retry, no per-tenant concurrency/cost cap**; final evaluation runs **inline** on the candidate's last request. One OpenRouter hang parks thousands of connections. | `llmService.js:87`, `aiInterviewService.js:218-240` |
| F7 | **HIGH (compliance/legal)** | ATS **auto-rejects + emails** below-threshold candidates with **no human review**; candidate **name** is injected into the AI scoring prompt (bias proxy). | `atsService.js:61-74`, `interviewPrompts.js:40` |
| F8 | **HIGH (compliance)** | Full resume PII shipped to a **global** LLM router with no consent/DPA/zero-retention pin — conflicts with the India-residency decision. | `llmService.js`, `interviewPrompts.js:18-50` |
| F9 | **HIGH (integrity)** | **Prompt injection** wide open: resume/answer text flows into the evaluation prompt and can steer `recommendation`/`overallScore`. | `interviewPrompts.js`, `aiInterviewService.js` |
| F10 | **MEDIUM** | Company **suspension/payment status enforced only at login**, not per request → suspended tenant keeps access for up to token lifetime (7 d). | `middleware/auth.js:18-24` |
| F11 | **MEDIUM (scale)** | No compound indexes on hot paths (candidate-by-company+status, candidate-by-email, session reminder scan, notifications list). | all `models/*` |
| F12 | **MEDIUM (ops)** | No graceful shutdown, no real readiness probe, no env validation at boot, in-memory HTTP rate limiter, untuned Mongo pool. | `server.js`, `config/db.js`, `companyAuthRoutes.js` |
| F13 | **MEDIUM (ML)** | No evaluation **provenance/reproducibility** (no model id, prompt version, seed, tokens, raw response) → an AI hiring decision can't be defended if challenged. | `InterviewSession.js:61-76` |
| F14 | **LOW** | 403-vs-404 existence oracle on billing; `toggleSavedJob` accepts any job id; flat upload dir; `EmailLog`/`Resume` lack `company`. | `paymentController.js`, `candidateDashboardController.js:119` |

---

## 2. Target architecture (self-hosted, India, pilot → nationwide)

```
                       ┌──────────────── India VPS(s), single region ────────────────┐
   Internet ──TLS──►  │  Caddy / Nginx (TLS, gzip, rate-limit, sticky for WS)         │
                       │        │                                                      │
                       │        ├──► app-api  ×1–2   (Express: HTTP + Socket.io)       │
                       │        │        (stateless; scale by adding replicas)         │
                       │        │                                                      │
                       │        └──► app-worker ×1    (BullMQ consumers + ALL cron)    │
                       │                 (exactly one replica owns cron)               │
                       │                                                               │
                       │  Redis  ── Socket.io adapter · BullMQ · rate-limit · locks    │
                       │  MongoDB (replica set, 3 nodes) ── all tenant data            │
                       │  MinIO (S3-compatible) ── resumes, photos, recordings         │
                       │  Backups (Mongo dump + oplog, MinIO mirror) → offsite (India) │
                       └───────────────────────────────────────────────────────────────┘
        External: OpenRouter (LLM) — see §6 for the India-residency handling
```

**Pilot topology (one or two VPS):** 1× api + 1× worker + Redis + Mongo (start 3-node replica set even at pilot — it's what enables PITR/RPO and zero-downtime restarts) + MinIO, all Docker Compose on an **India-located** VPS (AWS Lightsail/EC2 `ap-south-1`, DigitalOcean `blr1`, or an Indian provider such as E2E Networks / CtrlS for a stronger residency story). Nginx/Caddy terminates TLS and does sticky sessions for the WebSocket handshake.

**Nationwide path (no rewrite):** add api replicas behind the LB, split the worker into a dedicated fleet, move Mongo to a managed/replicated cluster, add a read replica for dashboards, put MinIO behind a CDN, migrate Compose → k8s. Every item below is written so this is a scaling operation, not a redesign.

---

## 3. Multi-tenancy hardening (the core deliverable)

Shared-DB isolation is only as strong as its weakest query. Today's explicit scoping is good but relies on every developer remembering the filter forever. Add a **defense-in-depth guardrail** so a forgotten filter fails safe.

**3.1 Tenant context + auto-scoping plugin (the safety net).**
- Establish a per-request **tenant context** using `AsyncLocalStorage` set in `requireAuth` (`{ companyId, userId, role }`).
- A Mongoose **plugin applied to every tenant-scoped model** (`Candidate`, `Job`, `InterviewSession`, `InterviewQueue`, `AdminNotification`, `Payment`, `Invoice`, `Subscription`, `Workspace`, `CompanySettings`, and the new `Recording`/`Violation`/`UsageEvent`/`AiDecisionLog`):
  - `pre` hook on `find/findOne/count/update/delete/aggregate` injects `{ company: ctx.companyId }` when a tenant context exists.
  - `pre('save')` asserts `doc.company` is set.
  - A model flagged `tenantScoped` that runs a query with **no** tenant context in production throws (fail-closed) — except for explicitly whitelisted system jobs (cron/worker) that opt out via a `runAsSystem()` wrapper.
- Result: even if a controller forgets the filter, the plugin adds it; a cross-tenant query becomes structurally impossible rather than a code-review hope.

**3.2 Close the concrete holes (from §1).**
- **F1:** `getJob` returns 404 unless `job.status === "published"` (mirror `listPublishedJobs`); keep the route public but published-only.
- **F10:** add `requireActiveCompany` middleware that re-reads `company.status` (cached ~60 s in Redis) on all company-scoped routers → suspended/unpaid tenants lose access immediately, not at token expiry.
- **F14:** billing handlers return 404 (not 403) on company mismatch; `toggleSavedJob` requires `status:"published"`; namespace uploads as `uploads/<companyId>/…` (defense-in-depth); add `company` to `EmailLog` for per-tenant audit/filtering.

**3.3 Per-tenant configuration & limits.** Extend `CompanySettings` into the tenant control plane:
```
CompanySettings.ai         { provider, model, apiKeyRef, monthlyBudgetCents, hardCap, temperature }
CompanySettings.proctoring { enabled, recordVideo, secondaryCamera }
CompanySettings.compliance { aiConsentRequired, biometricConsentRequired, autoRejectAllowed, retentionDays }
CompanySettings.limits     { maxConcurrentInterviews, apiRateLimitPerMin }
```
- **Per-tenant LLM cost caps + metering** (new `UsageEvent` collection: tenant, session, model, promptTokens, completionTokens, costCents, latencyMs). Enforce the cap **before** dispatch so one tenant can't burn the shared key or another tenant's budget.
- **Per-tenant rate limiting** on the hot paths (`interview/answer`, `speed-test-file`, auth) using `rate-limit-redis` (shared across instances — fixes F12's per-instance limiter).

**3.4 Tenant lifecycle & onboarding (operational multi-tenancy).**
- Self-serve signup → OTP → subscription → provision already exists (keep it). Add: **suspend/reactivate/offboard** admin actions; **tenant data export** (DPDP portability); **hard-delete with retention** (DPDP erasure). Each is a tenant-scoped batch job on the worker.

---

## 4. Scale & reliability hardening (make it survive > 1 instance)

Ordered so the app is safe to run multi-instance, then fast, then observable.

**4.1 Make Redis mandatory + fix statefulness (F2–F5).**
- Add `@socket.io/redis-adapter`; wire `io.adapter(...)` in `config/socket.js`. Redis becomes a hard prod dependency (validate at boot).
- **Move ALL cron + BullMQ consumers into the `app-worker` process** (run exactly one replica). Remove `startEmailWorker`/`start*Job` from the API `server.js`. As a second guard, convert each reminder guard to an **atomic claim**: `findOneAndUpdate({_id, reminder24hSent:false}, {$set:{reminder24hSent:true}})` and only send if a doc was returned (claim-before-send) — safe even if the worker is ever scaled to >1.
- Replace local-disk storage with **MinIO** (S3 API): `multer-s3` for uploads; store the object key; replace every `fs.readFile`/`res.download` on `resumePath`/`filePath`/`photoPath` with a MinIO get / presigned-URL redirect. This alone fixes the silent ATS-scores-empty-text bug.

**4.2 Make the LLM path safe under load (F6).**
- Add `AbortSignal.timeout(30_000)` to the OpenRouter `fetch`; bounded exponential-backoff retry on 408/429/5xx honoring `Retry-After`; a circuit breaker per tenant.
- **Move the final evaluation off the request path**: enqueue it as a BullMQ job on `submitAnswer` (it already notifies the admin when done) instead of blocking the candidate's last HTTP call with the slow `thinking:true` call.
- Global + per-tenant **concurrency limiter** (Redis token bucket) in front of LLM calls.
- Cache job/candidate context on the session at `beginInterview` (stop re-`populate`-ing every turn); use `$push` for turns instead of full-doc `save()` (F-H2).

**4.3 Indexes & DB tuning (F11, F12).**
- Add compound indexes: `Candidate {company:1,status:1}`, `Candidate {job:1,company:1}`, `Candidate {"basicDetails.email":1}`; `InterviewSession {status:1,interviewAt:1}` + TTL/`{expiresAt:1}`; `Notification {user:1,createdAt:-1}`, `AdminNotification {company:1,createdAt:-1}`.
- `mongoose.connect` with `maxPoolSize`/`minPoolSize`, `serverSelectionTimeoutMS`; replica set with `secondaryPreferred` reads for dashboards.

**4.4 Operational hardening (F12).**
- **Fail-fast env validation** at boot (both JWT secrets, Redis, Mongo, MinIO, SMTP) — a missing secret should crash startup, not fail silently per request.
- **Graceful shutdown**: SIGTERM → stop accepting → `httpServer.close()` → drain sockets → `worker.close()` → `mongoose.disconnect()`.
- **Health vs readiness**: keep `/health` as liveness; add `/ready` that pings Mongo + Redis (LB uses readiness).
- Add `helmet`, `compression`, `express.json({ limit })`, `server.requestTimeout`/`headersTimeout`.
- **Observability**: structured logs (pino) with `requestId` + `companyId`, basic metrics (Prometheus `/metrics` or a hosted APM), golden-signal alerts (error rate, p99 latency, queue depth, LLM failure rate, per-tenant spend).

---

## 5. Security & DPDP compliance (India)

**5.1 Platform security.**
- Refresh-token flow + rotation + short-lived access tokens (currently a single 7-day JWT — see F10); httpOnly secure cookies.
- Secrets in a manager (self-host: `docker secrets`/Vault/SOPS), not plaintext `.env` on the box.
- `AuditLog` model + middleware on all mutating routes (actor, tenant, action, before/after) — the `by` field already on stage history is the seed.
- TLS everywhere; encrypt Mongo + MinIO **at rest** (LUKS/volume encryption + MinIO SSE); network-isolate DB/Redis/MinIO (no public ports).
- Pen-test + dependency scanning before go-live.

**5.2 DPDP Act 2023 (data-fiduciary obligations).**
- **Consent**: explicit, informed consent capture before processing personal data (resume, answers) and a **separate** consent for biometric/video (identity photo, proctoring). Store `consentAt` + purpose + version.
- **Data residency**: Mongo, MinIO, and all backups in an **India** region. The one leak is the LLM (§6).
- **Data-principal rights**: access, correction, **erasure**, and portability endpoints + a named **Grievance/Data-Protection Officer** contact.
- **Retention**: per-tenant `retentionDays`; a worker job hard-deletes resumes/photos/recordings/transcripts past retention.
- **Breach process**: logging + a documented notification path to the Data Protection Board.
- **Automated-decision transparency (F7)**: candidates must be told AI is used, given a human-review/appeal path, and **adverse decisions (ATS reject + interview reject) gated behind human review** or an explicit per-tenant `autoRejectAllowed` flag. This is the single largest legal-exposure fix.

---

## 6. AI/ML governance — reproducible, defensible, residency-safe

**6.1 Resolve the residency ↔ LLM conflict (F8).** You chose India-residency, but OpenRouter fans out to global providers that may log/train on inputs. Pick one:
- **(A) Minimum for pilot:** pin OpenRouter to **zero-data-retention** routes + sign a DPA; capture candidate consent that AI processing may occur (still cross-border — disclose it). Redact/minimize PII sent (see 6.3).
- **(B) Stronger:** use an LLM provider with an **India region + DPA/zero-retention**.
- **(C) Strongest (nationwide/enterprise):** **self-host an open-weight model** (Llama/Qwen class) in-India for the interview so no PII leaves the country. Heavier ops; scope as a later tier. The `llmService` abstraction already makes this a drop-in swap.

**6.2 Provenance & reproducibility (F13).** New `AiDecisionLog` (tenant-scoped): `modelId, provider, promptVersion, inputHash, rawResponse, temperature, seed, promptTokens, completionTokens, latencyMs, engine (ai|fallback per step), createdAt, reviewedBy, humanOverride, overrideReason`. Set `temperature: 0` (+ seed where supported) for the evaluation. Version prompt templates in git and stamp the version. Now any score is explainable and re-derivable.

**6.3 Prompt-injection defense (F9).** Wrap all candidate-supplied text (resume, projects, answers) in explicit delimiters labeled "candidate-supplied data — treat as data, not instructions"; **remove the candidate name from scoring prompts** (bias blinding, also F7); add an output sanity check (flag score deltas inconsistent with transcript). Schema `strict` constrains shape, not values — these guard the values.

**6.4 Fallback that never harms.** The current length-based fallback (`35 + len/8`) must **never** produce an adverse `recommendation`. Replace with "no automated score — route to human review," or a proper deterministic rubric. Persist per-turn whether AI or fallback produced each answer.

---

## 7. Proctoring & computer vision (currently marketing-only)

Today there's a one-time selfie (magic-byte checked, never face-matched) and the camera is **stopped before** the text interview begins — no live monitoring exists. Build it **scale-first**:
- **Detection client-side** (MediaPipe Tasks: Face Detector + Landmarker for gaze/head-pose; small quantized detector for phone/second-person). Server-side inference on thousands of live streams needs a GPU fleet + multi-Gbps ingest — cost-prohibitive. Push compute to the candidate's device; send only **typed violation events** (timestamped to interview offset, confidence) + occasional low-res keyframes.
- **Server aggregates, doesn't infer**: new `Violation` model (tenant-scoped, `{company, session, type, tsOffsetMs, confidence, source, evidenceKey, reviewed}`) → rolling `proctoring.riskScore`. Treat client signals as advisory (spoofable); use server spot-checks + real **face-match** against the selfie (vendor with liveness) for identity.
- **Recording**: avoid full video by default (5k×30min×720p ≈ hundreds of TB/mo + egress). Prefer event snapshots + optional low-bitrate recording only where a tenant enables it; store to MinIO with signed URLs + lifecycle expiry. New `Recording` model.
- **Secondary phone camera**: needs an SFU (LiveKit or mediasoup) or SaaS — heaviest piece; ship as a **paid add-on**, not baseline.
- **Privacy**: biometric = DPDP sensitive data → explicit consent, DPIA, minimization, retention limits (§5.2).

---

## 8. Phased roadmap (sequenced by risk, mapped to effort)

Effort in engineering-days for one mid/senior dev. Do the workstreams roughly in order; W1–W3 are the gate to onboarding a real paying tenant.

| Wave | Workstream | Fixes | Effort | Gate |
|---|---|---|---|---|
| **W1 — Isolation & correctness** ✅ SHIPPED | Fix F1 (job leak), F10 (suspension gate), F14 (oracles/save-job); added the **tenant guardrail plugin** (§3.1) + tenant-context. | F1, F10, F14 | **4–6 d** | No cross-tenant read possible; suspended tenants blocked. |
| **W2 — Multi-instance safety** ✅ SHIPPED | Redis mandatory-in-prod + Socket.io adapter (F2); cron+workers → dedicated `npm run worker` with atomic claim-before-send (F3, F5); MinIO/S3 storage abstraction (F4); env validation, graceful shutdown, readiness probe. | F2–F5, F12(part) | **6–8 d** | App runs correctly on 2+ instances; no dup emails; files shared. |
| **W3 — LLM safety & cost** ✅ SHIPPED | LLM timeout + retry/backoff; evaluation moved off the request path; per-tenant **cost metering (`UsageEvent`) + budget cap**; per-tenant `ai` config in `CompanySettings`; rate limiting on `interview/answer` + `speed-test`. _(True concurrency limiter deferred to the scale wave.)_ | F6, H1–H3 | **5–7 d** | One tenant/one bad token can't melt the app or overspend. |
| **W4 — Compliance & AI governance** ✅ SHIPPED | Consent capture (apply form → `Candidate.consent`) + **human-in-the-loop ATS** (`autoRejectAllowed`) + bias-blinded evaluation (F7); external LLM gated on consent so no-consent keeps PII local — 6.1(A) minimum (zero-retention DPA is an operational config); evaluation/turn **provenance** via `UsageEvent` + stored fields (F13); prompt-injection delimiters (F9); **fallback never emits an adverse recommendation** — routes to human "review" (6.4). | F7, F8(part), F9, F13 | **6–9 d** | AI decisions consent-backed, auditable, defensible; no auto-reject without review. |
| **W5 — DPDP & security platform** ✅ SHIPPED (code) | Nightly **retention job** + **erasure**/DPDP-**export** endpoints + public **DPO** contact; **`AuditLog`** + middleware on mutating routes; **rotating refresh tokens** + short-lived access (silent refresh in both frontends, reuse-detection, server-side revocation); `helmet`/`compression`/JSON limit/request timeouts (F12). _Deferred to ops: encryption-at-rest (LUKS/MinIO SSE) + secrets manager; a CompanySettings admin UI + httpOnly-cookie refresh storage are follow-ups._ | F12 + §5 | **6–8 d** | DPDP data-principal rights + security baseline met. |
| **W6 — Performance & observability** ✅ SHIPPED (code) | Compound indexes matched to hot paths + redundant single-field indexes dropped + `sync:indexes` reconcile script (F11); Mongo pool/timeout tuning + prod `autoIndex` off; structured JSON logs + `x-request-id` correlation; `GET /metrics` (Prometheus counter+histogram+gauges); zero-dep load-test script with SLO gate; [OBSERVABILITY.md](OBSERVABILITY.md) with golden-signal alert rules. _Deferred to ops: run the 100-concurrent load test on live infra + wire Prometheus/Alertmanager._ | F11 | **3–5 d** | SLO (§0) met under 100-concurrent load test. |
| **W7 — Proctoring MVP** _(after pilot)_ | Client-side face/gaze/phone detection → `Violation` + risk score + evidence; face-match on identity. | §7 | **10–15 d** | Live monitoring + admin review of violations. |
| **W8 — Recording + secondary camera** _(add-on)_ | SFU + phone-cam WebRTC + optional recording to MinIO. | §7 | **12–18 d** | Paid add-on tier. |
| **W9 — Admin AI-report review** ✅ SHIPPED | Endpoint (`GET /candidates/:id/interview-report`, curated + tenant-scoped) + admin screen (transcript, evaluation, decision actions). | — | **2–3 d** | Recruiters can act on AI interviews. |

**Pilot go-live = W1–W6 complete + W9.** Roughly **6–8 focused weeks** for one senior dev (the scale audit independently estimated ~2–3 weeks just for the horizontal-scale slice, W2/W6).

---

## 9. Go-live readiness checklist (definition of "foolproof")

Hand-to-a-company acceptance criteria:

- [ ] Tenant guardrail plugin live; a query with no tenant context fails closed (test proves it).
- [ ] F1 job leak closed; automated test asserts anonymous `GET /jobs/:id` on a draft → 404.
- [ ] App verified correct on **2 instances** (sockets deliver, no duplicate emails, files readable).
- [ ] LLM calls have timeout + retry; evaluation is async; per-tenant cost cap enforced (load-tested).
- [ ] No adverse hiring decision without human review or explicit tenant opt-in; consent captured; AI decisions logged with provenance.
- [ ] All PII (Mongo/MinIO/backups) in India; LLM residency handled per 6.1 with consent disclosure.
- [ ] DPDP: consent, retention job, erasure/export endpoints, named DPO.
- [ ] Backups tested with a **restore drill** meeting RPO/RTO; monitoring + alerts wired.
- [ ] Refresh tokens, encryption at rest, secrets manager, env-validation, graceful shutdown, readiness probe.
- [ ] Load test at 100 concurrent meets the §0 SLO.
- [ ] Runbook: deploy, rollback, backup/restore, tenant suspend/offboard, incident response.

---

## 10. Open risks & external dependencies

- **LLM residency (6.1)** is the hardest compliance call — decide A/B/C early; it affects consent copy and cost.
- **Secondary-camera & full recording** carry the biggest infra cost (SFU + storage/egress) — keep as paid add-ons, not baseline.
- **Self-host ops burden**: you own Mongo replica-set health, backups, TLS renewal, patching, and uptime. Budget for on-call or a managed-DB fallback (Mongo Atlas India) if the team is small.
- **Job-board publishing** (IMPLEMENTATION-PLAN Phase 5) mostly needs partner API access — external, not just code.
- **Bias/fairness at nationwide scale**: if you ever expose to US clients, NYC LL144 / EEOC add a bias-audit + notice obligation on top of DPDP.
