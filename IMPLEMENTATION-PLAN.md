# AI Recruitment Platform — Implementation Plan & Gap Analysis

_Derived from `recruit docs.docx` (Master Requirements) compared against the current codebase, 2026-07-20._

---

## 0. Read this first — spec vs. reality

The requirements doc specifies one stack; the actual build uses another. This is the single most important framing fact for planning.

| Concern | Doc says | Actually built | Impact |
|---|---|---|---|
| Frontend | React **19 + TypeScript**, Redux Toolkit, React Query | React **18 + plain JS**, no Redux, no React Query | Doc's TS/Prisma snippets don't map 1:1; keep building in JS unless a rewrite is decided |
| Backend | Node + Express + **TypeScript** | Express + **CommonJS JS** | Same |
| Database | **PostgreSQL + Prisma**, Repository Pattern | **MongoDB + Mongoose**, service layer (no repo pattern) | "Create Prisma table" tasks become "create Mongoose model" |
| Roles | Super Admin, Company Admin, Candidate | Company Admin + Candidate only | **No Super Admin** built |
| Auth | JWT **+ Refresh Token** | Single JWT (two secrets), **no refresh token** | Refresh-token flow missing |
| Storage | Cloudinary / S3 | Local disk (`uploads/`) | No cloud storage |

> **Decision needed:** keep the current JS/Mongo stack (recommended — most of the platform already works on it) or migrate to the doc's TS/Postgres/Prisma stack (a full rewrite). This plan assumes **keep the current stack** and treats the doc as a feature spec, not a stack mandate.

---

## 1. Status at a glance

The platform is roughly **~55% of the doc built** — but the built half is the "plumbing" (onboarding, billing, ATS, scheduling, notifications). **The entire "AI" half — the actual product differentiator — is not built.** The "AI Interview" today only flips a session status to `in_progress`; no interview is conducted.

| Area | Status |
|---|---|
| Project structure, layered backend | ✅ Done |
| Company onboarding + OTP + subscription + Razorpay + workspace | ✅ Done |
| Candidate registration + dashboard | ✅ Done |
| Resume upload + text extraction | ✅ Done |
| ATS engine (deterministic) + auto-queue/reject | ✅ Done |
| Interview invitation (magic link, token, email, expiry) | ✅ Done |
| Interview portal pre-checks (cam/mic/screen/fullscreen/speed/device/identity) | ✅ Done |
| Notification & communication engine (socket, BullMQ, logs, reminders) | ✅ Done |
| Hiring pipeline / candidate lifecycle (13 stages, timeline) | ✅ Done (Phase 1) |
| Admin dashboard actions (offer, multi-round, export) | ✅ Done (Phase 1) |
| Reports / Analytics | 🟡 Thin |
| **AI Interview Engine** — text-first adaptive (OpenRouter) | 🟡 Core done (Phase 2); voice + scale deferred |
| **AI Proctoring** | ❌ Missing |
| **Secondary camera (QR + phone WebRTC)** | ❌ Missing |
| **AI Evaluation + transcript + PDF report** | ❌ Missing |
| **Interview recording** | ❌ Missing |
| **External job-board publishing (LinkedIn/Indeed/…)** | ❌ Missing |
| Super Admin role, Audit logs, Departments, Refresh tokens | ❌ Missing |

---

## 2. What is DONE ✅

Verified in code.

- **Three-app structure** (`backend/`, `admin/`, `user/`) with layered backend (`routes → controllers → services → models/utils`). _(Doc's `docs/` and `docker/` folders not present.)_
- **Three identity systems** + JWT (two secrets), RBAC via `requireAuth`/`requireRole`/`requireCandidate`.
- **Company registration + email OTP** (`OTPVerification`, 6-digit, 10-min expiry, 5 attempts, resend cooldown, rate limit) → verify → provision.
- **Subscription + Payment**: `SubscriptionPlan` seeding, Razorpay checkout, **raw-body webhook signature verification**, `Invoice`, payment history, `workspaceProvisioningService` upserts `Subscription`+`Workspace`+`CompanySettings` and flips company `active`.
- **Candidate registration + dashboard** (profile, saved jobs, applied jobs).
- **Resume upload**: PDF/DOCX, magic-byte signature check (`verifyFileSignature`), text extraction (pdf-parse/mammoth), stored `Resume` doc.
- **ATS engine** (`atsService` + `atsEngine`): weighted skills/experience/education/projects/certification/keyword scoring → pass (≥ `job.atsThreshold`, default 60) auto-upserts `InterviewQueue` + mints interview session; fail → rejection email. Idempotent; re-runnable via `POST /api/candidates/:id/ats/rerun`.
- **Interview invitation**: `InterviewSession` with hashed magic-link token, `interviewAt`, `expiresAt`, instructions, invitation email + dashboard notification. Idempotent session creation.
- **Interview portal pre-checks**: login via magic link, device compatibility, camera/mic/screen-share/fullscreen flags, internet speed test, identity photo upload. `/start` marks session `in_progress`.
- **Notification & communication engine**: `notificationService` (notify candidate/admin) → `Notification`/`AdminNotification` doc + Socket.io room emit + templated email via `emailDispatchService` (writes `EmailLog`, enqueues BullMQ if `REDIS_URL` else inline). Reminder cron (24h/1h), subscription-expiry cron.

---

## 3. What is PARTIAL 🟡

### 3.1 Hiring pipeline & candidate lifecycle (Doc "Module 11 — Hiring Pipeline")
- **Now:** `Candidate.status` enum has only `applied | interview_queue | shortlisted | next_round | rejected`.
- **Doc wants 13 timestamped stages:** Applied → ATS Passed → Interview Scheduled → AI Interview Completed → Under Review → Shortlisted → HR Interview → Technical Interview → Manager Interview → Selected → Offer Sent → Offer Accepted → Joined (or Rejected), each with a **timeline**, **stage history**, and **visible in both dashboards**.
- **Missing:** stage-transition validation (no illegal jumps), `CandidateTimeline`/`StageHistory` records, offer tracking, multi-round scheduling, "mark joined", report download/export, admin activity history.

### 3.2 Admin dashboard actions
- **Now:** view candidates/ATS, remove-from-queue, basic status changes.
- **Missing per doc:** Schedule HR/Technical/Manager rounds, Send Offer Letter, Mark Joined, Download/Export candidate report, view recording/transcript/violations (those artifacts don't exist yet).

### 3.3 Reports / Analytics
- `Reports.jsx` (95 lines) and admin analytics exist but are thin; doc calls for real reports/analytics dashboards.

---

## 4. What is MISSING ❌ — the entire AI half

These are the product's headline features and are **not started** (confirmed: zero references to proctoring/webrtc/openai/gemini/transcript/evaluation/QR in the backend).

### 4.1 AI Interview Engine (Doc Modules "AI Interview Engine", 9, 9b) — **biggest gap**
Real-time voice interview that behaves like a human interviewer:
- Pre-interview context load: JD + resume + ATS + skills + projects + experience + education → interview plan + difficulty estimate.
- Voice conversation: streaming STT, turn detection, natural interruptions, TTS voice playback.
- Conversation memory (never repeat questions; track weak/strong topics).
- Dynamic question generation + adaptive difficulty + follow-ups + project deep-dives + coding + behavioral.
- 10 specialized services (Resume Understanding, JD Understanding, Streaming STT, Conversation Memory, Reasoning, Question Generator, Turn Detection, Voice Synthesis, Evaluation, Transcript).
- Architecture: WebSocket session manager, BullMQ workers, horizontal scale to 10k+ concurrent, fault tolerance, retry.
- **Today:** `/start` only sets `status = in_progress`. No LLM, no audio, no questions.

### 4.2 AI Proctoring
Monitor laptop cam + phone cam + mic; detect multiple faces / phone usage / looking away / another person / background voice / no face / camera blocked. Produce violation log + risk score + evidence + timeline. **Not started.**

### 4.3 Secondary camera system
Second QR code + secure link → phone camera → WebRTC stream to backend, synchronized with laptop cam + mic. **Not started** (session model has no phone-camera fields beyond a placeholder identity photo).

### 4.4 AI Evaluation Engine + reports
Score communication/technical/problem-solving/etc. → overall score, strengths, weaknesses, hiring recommendation → generate **PDF report** + full **transcript**, store, surface in admin dashboard. **Not started.**

### 4.5 Interview recording
Store laptop + phone video/audio for admin playback. **Not started.**

### 4.6 External job-board publishing
Publish → queue → connectors for LinkedIn / Indeed / Naukri / Foundit / Glassdoor / Internshala / career page → store published URLs + track status (`PlatformConnector` pattern). **Not started.**

### 4.7 Platform gaps
- **Super Admin** role (cross-company oversight).
- **Audit logs** (doc asks repeatedly; no `AuditLog` model).
- **Departments** module (Job has only a `department` string).
- **Refresh tokens** (currently single short-lived JWT).
- **Cloud storage** (Cloudinary/S3) — currently local disk.

---

## 5. Phased roadmap (recommended order)

Ordered by dependency and value. Each phase is shippable on its own.

### Phase 1 — Hiring pipeline & lifecycle (extends what exists) — ✅ DONE (2026-07-20)
Highest ROI, lowest risk; no new infra. Shipped:
1. ✅ `Candidate.status` expanded to the 13-stage enum; added `stageHistory[]` (stage/at/by/note) and an `offer` sub-doc. Pure stage logic in `backend/utils/pipeline.js` (order, labels, legacy normalization, `canTransition`).
2. ✅ Stage-transition guard (forward-only + round laterals + reject-from-any; blocks terminal/no-op/illegal jumps) enforced server-side in `services/pipelineService.js` and mirrored client-side in `admin/src/lib/pipeline.js`.
3. ✅ New endpoints: `PATCH /candidates/:id/stage` (+ legacy `/status`), `GET /candidates/:id/timeline`, `GET /candidates/:id/export` (JSON report; PDF later). Rounds/offer/joined are all just target stages of the one move endpoint.
4. ✅ Each transition fans out through the existing `notificationService` → in-app + email (new generic `stageUpdateEmailTemplate`, reused offer/rejection) + a dedicated `candidate:stage` socket event.
5. ✅ Admin **Hiring Pipeline** kanban board (`/pipeline`, nav link) with inline moves; **CandidateDetail** stage control + progress stepper + timeline + offer + export; **CandidatesAll** stage filter; DashboardHome/Reports/CandidateList relabelled. Candidate dashboard gets a live **Application Status** tracker (socket-driven, no refresh).
6. ✅ ATS records stage history silently; `stageHistory` seeded on apply. Migration `npm run migrate:stages` remaps legacy `interview_queue`/`next_round` and backfills history. Actor recorded on every transition (`by`) — seeds Phase 6 audit logs.

_Verified: pipeline transition unit test green, Candidate schema validates, all changed backend modules load, and both `admin` and `user` Vite builds pass._

> Remaining Phase-1 polish (optional, deferred): dedicated `AdminActivity` audit model, PDF (vs JSON) candidate report, drag-and-drop on the board, Mongo optimistic-concurrency guard for simultaneous admin edits.

### Phase 2 — AI Interview Engine core (the headline) — 🟡 Text-first core SHIPPED (2026-07-20)
The hard, high-value module, built incrementally. **Text-first adaptive interview is live**; voice + horizontal-scale infra deferred.

**✅ Done — text-first adaptive interview:**
1. ✅ **Data + session:** `InterviewSession.aiInterview` embedded sub-doc (`models/InterviewSession.js`) — plan, turns, askedQuestions, currentDifficulty, evaluation, status; added `completed` session status.
2. ✅ **Provider chosen:** **OpenRouter** (OpenAI-compatible Chat Completions) via native `fetch`, isolated in `services/llmService.js` (structured outputs via `response_format` json_schema; any OpenRouter model via `AI_INTERVIEW_MODEL`, swappable). **Keyless fallback**: with no `OPENROUTER_API_KEY` the engine still runs a deterministic text interview + heuristic report (mirrors the mailer's jsonTransport degradation), so the app runs end-to-end without a key.
3. ✅ **Context services:** `utils/interviewPrompts.js` assembles a token-bounded briefing from JD + resume + ATS + skills + projects + experience/education → interview plan.
4. ✅ **Question generator + reasoning + memory:** `services/aiInterviewService.js` — plan → ask → score-answer + adapt-difficulty → next question (no-repeat via `askedQuestions`, bounded by `maxQuestions`) → final evaluation. Turn-based over REST.
5. ✅ **Portal + UI:** portal endpoints (`POST /start` begins, `GET /interview` state, `POST /interview/answer`); candidate **InterviewRoom** chat screen (`user/…/InterviewRoom.jsx`) wired after pre-checks.
6. ✅ **Completion flow:** stores evaluation, advances candidate stage → **AI Interview Completed** (via Phase-1 pipeline), notifies admin `ai_report_ready`.

**⬜ Deferred (next Phase-2 sub-steps):**
- **WebSocket channel** + BullMQ `interview-worker` per session + Redis-backed session state for 10k-concurrent horizontal scale (currently turn-based REST, single-process).
- **Voice layer:** streaming STT + turn detection + TTS playback; mic streaming + live transcript + AI voice (Doc Module 9b steps 10–14). Vendor still to choose.
- Admin-side review of the transcript + AI report (feeds Phase 4).

_Verified: pipeline/schema load, `InterviewSession` validates, keyless fallback active, all new backend modules load, user Vite build passes._

### Phase 3 — Proctoring + secondary camera — _L_
1. Secondary camera: generate 2nd QR + token, phone page, WebRTC (mediasoup/LiveKit or a SaaS) streaming to backend, sync with laptop.
2. Proctoring: client-side face/gaze/phone detection (e.g. MediaPipe/TF.js) + server-side aggregation → `Violation` log + risk score + evidence timeline.
3. Recording pipeline → cloud storage (introduce Cloudinary/S3 here).

### Phase 4 — AI Evaluation + reports + admin review — _M/L_
1. Evaluation service consumes transcript + proctoring → scores + strengths/weaknesses + recommendation.
2. PDF report generation (e.g. pdfkit/puppeteer) → store → surface in admin.
3. Admin review screen: transcript, recording, violations, report, actions (reject/shortlist/next round/offer — reuses Phase 1).

### Phase 5 — External job-board publishing — _M_
1. `PlatformConnector` interface + per-board connector stubs; `PublishedJob` model (board, url, status).
2. BullMQ publish queue + status tracking UI. (Most boards need official API/partner access — flag as external dependency.)

### Phase 6 — Platform hardening — _M_
1. **Super Admin** role + cross-company admin views.
2. **Refresh-token** flow + secure cookies + rotation.
3. **Audit logs** model + middleware across mutating routes.
4. **Departments** as first-class model.
5. Real **Reports/Analytics** dashboards.
6. Security items from doc Part M (rate limiting everywhere, input sanitization, XSS/CSRF hardening, cloud file storage).

---

## 6. Decisions to confirm before coding

1. **Stack:** keep JS + MongoDB (recommended) or migrate to the doc's TS + Postgres + Prisma?
2. **AI providers:** LLM (OpenRouter — model set via `AI_INTERVIEW_MODEL`) + realtime STT/TTS vendor + WebRTC (self-host mediasoup vs LiveKit/SaaS)?
3. **Scope priority:** ship **Phase 1 (pipeline)** first for immediate value, or go straight at **Phase 2 (AI interview)** as the differentiator?
4. **Voice-first vs text-first** for the interview MVP (text-first de-risks; voice is the doc's true goal)?
5. **Cloud storage** now (needed for recordings) or defer?

---

### Suggested first sprint
Phase 1 end-to-end (13-stage pipeline + timeline + admin board + candidate tracker + notifications). It's self-contained, reuses the existing notification/socket infra, and unblocks the admin review screen that Phases 2–4 feed into.
