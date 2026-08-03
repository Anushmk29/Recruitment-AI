# Project Update Log

A running log of every change made to this codebase: **what** was done, **why**, and **which files/folders** were touched. Newest entries at the top. Companion to `IMPLEMENTATION-PLAN.md` (roadmap) and `MULTI-TENANT-PLAN.md` (production-readiness plan).

> **To see what's done vs still left at a glance, use [STATUS.md](STATUS.md)** — the checkbox status board. This file is the detailed history; STATUS.md is the tracker.

> **How to maintain this file:** add a new `## <date> — <title>` section at the top for each unit of work. Under it, a short **What / Why**, then a **Files** table (`path` · `change`). Mark verification status. Keep paths repo-relative.

Legend: 🆕 new file · ✏️ modified · 🗑️ removed

---

## 2026-08-03 — Product: an interviewer you can interrupt, that understands what you meant

**What:** Two changes to how the live interview behaves in the room, plus the plumbing they need.

1. **The microphone stays open while the interviewer speaks — on every device.** Interruption used
   to be armed only where the pre-check tone measured that the mic could not hear its own speakers
   (`portal/audioIsolation.js`), so every candidate without headphones got an interviewer they
   could not talk over. New `utils/echoAlignment.js` decides it differently: we know exactly what
   we are saying, so a transcript arriving during playback is struck word-for-word against our own
   outgoing sentence — anything our text accounts for is echo and is dropped, and a run of words we
   did not say is a person. Contiguous-run matching (not a percentage) is what makes it work on the
   only case that matters, the mixed transcript at the instant of a barge-in, where the echo tail is
   longer than the candidate's first words. Ambiguity resolves to **echo**, because a falsely
   truncated question does not count as asked and therefore does not cover its claim-probe, whereas
   a missed interruption only costs a second of overlap with the mic still recording.
2. **The interviewer reads intent instead of matching phrases.** Two tiers, composed by
   `utils/conversationIntent.js`: the existing deterministic matchers answer the plain phrasings in
   zero milliseconds, and `services/intentService.js` (the `cheap` model role) reads only the tail
   they miss — given the interviewer's own last sentence and the question in flight as context,
   which is what lets "sorry, what?" resolve to *repeat* after a question and *clarify* after an
   unfamiliar term. Understanding is open-ended; **consequences are a closed set** of eight actions
   declared in code, the words spoken back still come from the approved bank, and every reading is
   stored on the session with the model and prompt version that produced it.

   Three of those actions are new: **clarify** (heard it, didn't understand it — distinct from
   repeat, because replaying an identical sentence to someone who already heard it is the most
   machine-like thing an interviewer can do), **meta_question** (asking about the interview rather
   than answering it — answered from this session's real state via `utils/metaAnswers.js`), and
   **technical_problem**.

**Why:** requested — "I want it more interactive… mic should be on all the time… it should read
between the lines and understand what the candidate wants, not be like you give a command then I do
a particular stuff." Before this, a candidate asking "how many more of these are there?" had it
transcribed and scored as their answer to whatever had just been asked: they lost the question and
had a non-answer recorded against them for asking it.

**The rule this does not break.** "The model never emits the score" governs *evaluation*. Reading
what someone wants conversationally is *conduct* — it never touches a rubric criterion, an answer
score, a probe verdict or a recommendation, and nothing downstream reads an intent as evidence. The
property that was actually at risk — being able to say afterwards why the interviewer did what it
did — is preserved by the stored `{utterance, action, tier, model, promptVersion}` row.

**Backend**

| File | Change |
|---|---|
| 🆕 `backend/utils/echoAlignment.js` | Live echo rejection by text alignment. Pure + shared; thresholds ship to the browser via `clientPolicy()`. `VOICE_FULL_DUPLEX=false` restores the old pausing behaviour. |
| 🆕 `backend/utils/conversationIntent.js` | The closed action set, the precedence between actions, and `gateSemantic()` — the gate every inferred reading passes before anything acts on it. Everything that fails any check becomes `answer_continues`. |
| 🆕 `backend/utils/metaAnswers.js` | Approved answers to process questions, composed from session state. Boot-checked for evaluative language like the phrase bank. "How am I doing?" is deliberately absent and defers. |
| 🆕 `backend/services/intentService.js` | Tier-1 classifier over the `cheap` role. Own 1.5s timeout; every failure returns `answer_continues`; metered as `kind: "intent"`. |
| ✏️ `backend/controllers/interviewPortalController.js` | New `voiceIntent` (`POST /voice/intent`): re-runs the deterministic tier server-side rather than trusting the client's "nothing matched", composes meta answers from state, writes them into the transcript as turns (which is what makes them speakable at all under `speechAuthorization`). |
| ✏️ `backend/routes/interviewPortalRoutes.js` | Route + its own rate limiter (120/min — this fires per utterance, not per turn). |
| ✏️ `backend/utils/backchannel.js` | New `clarify` and `technical` banks; both reach the browser via `clientPolicy()`. |
| ✏️ `backend/services/personaService.js` | Ships the echo + intent policies with the streaming credential. |
| ✏️ `backend/models/InterviewSession.js` | Turn kinds `meta_question`/`meta_answer`; backchannel kinds `clarify`/`technical`; new `aiInterview.intents[]` audit array. |
| ✏️ `backend/models/UsageEvent.js` | `kind` enum gains `intent` — its cost curve scales with how much the candidate talks, not with how many questions were asked, so conflating it with per-turn spend would make unit economics unreadable. |
| ✏️ `backend/services/aiInterviewService.js` | `scoreUnscoredAnswers` now scores **only** `kind === "answer"`. It excluded `warmup_answer` by name, which meant every candidate turn kind added later was scored by default — and the first one added is a candidate asking how many questions are left. |
| ✏️ `backend/.env.example` | 10 new vars documented with the consequence of leaving each unset. |

**Frontend (`user/`)**

| File | Change |
|---|---|
| 🆕 `user/src/portal/echoAlignment.js` | Browser mirror of the server module (same split as `portal/endpointing.js`: classification here, thresholds from the server). |
| ✏️ `user/src/portal/useVoiceInterview.js` | Echo gate replaces the naive barge-in test; `withSpokenText()` makes every interviewer utterance echo-rejectable; the mic no longer closes around backchannels; `askAndListen` opens the mic before the question on every path; semantic tier wired in with staleness guards; diarization tallying now skipped whenever we have a voice in the air (it was only skipped during questions, so a backchannel would have flagged the candidate for a second speaker). |
| ✏️ `user/src/pages/InterviewRoom.jsx` | "You can start answering whenever you're ready" now shown from the hook's `canInterrupt` rather than only on measured-isolated hardware. |

**Bug found and fixed on the way:** `stopSpeaking()` called `audio.pause()`, which fires neither
`ended` nor `error` — so the promise `askAndListen` was awaiting never resolved and the turn hung
after a barge-in, mic open, with nothing listening for the end of the answer. Latent while
interruption needed measured-isolated hardware; universal the moment every candidate can interrupt.
`playUrl` now hands its resolver to `stopSpeaking`.

**Verified:** 604/604 backend tests pass (34 new — 31 behavioural in `voiceInteractivity.test.js`,
3 in `echoParity.test.js`). The parity test runs 648 cases through both copies of the echo gate and
asserts identical verdict, residue and novel-run — the mirrored `portal/endpointing.js` has never
had such a guard, and silent drift here would start cutting candidates off mid-question with no
other signal. `npm run check:env` green. `user` Vite build passes. Backend module graph loads.
**Not yet exercised live:** a real voice interview against Deepgram — the echo gate's behaviour on
actual room acoustics, and Tier-1 latency against the live provider, still need a smoke test.

---

## 2026-07-27 — Fix: phone-cam QR + interview links dead on a phone (LAN/multi-origin CORS)

**What:** The phone-cam pairing QR and every interview magic link were built from `CLIENT_ORIGIN_USER`, hardcoded to `http://localhost:5174` — meaningless once scanned/opened on an actual phone, where "localhost" means the phone itself. Added `utils/corsOrigins.js`: `CLIENT_ORIGIN_ADMIN`/`CLIENT_ORIGIN_USER` may now each hold a comma-separated list of origins — the **first** entry feeds every link-builder (interview invite email, phone-cam QR, password-reset link, public careers link), **all** entries feed the CORS and Socket.io allow-lists. Set `CLIENT_ORIGIN_USER` to the dev machine's LAN IP first, `localhost` second, so links/QRs are phone-reachable while the app still works from the machine's own browser.
**Why:** reported — "not able to connect using my phone as local host is not working" while scanning the "Phone as Second Camera" pairing QR from `PreInterviewCheck.jsx`.

**Backend**

| File | Change |
|---|---|
| 🆕 `backend/utils/corsOrigins.js` | `parseOrigins()` (flatten+trim comma list, feeds CORS/socket) and `firstOrigin()` (first entry + fallback, feeds link-builders). |
| ✏️ `backend/server.js`, `backend/config/socket.js` | CORS / Socket.io `origin` now built via `parseOrigins(...)` instead of a raw 2-element array. |
| ✏️ `backend/controllers/interviewPortalController.js` | `phonePair()` QR URL via `firstOrigin(CLIENT_ORIGIN_USER, ...)`. |
| ✏️ `backend/controllers/authController.js` | `originForRole()` (verification/reset links) via `firstOrigin(...)`. |
| ✏️ `backend/services/interviewInvitationService.js` | `buildInterviewUrl()` (interview magic link) via `firstOrigin(...)`. |
| ✏️ `backend/services/careersService.js` | `applyBaseUrl()` (public job-apply links) via `firstOrigin(...)`. |
| ✏️ `backend/.env` (git-ignored) | `CLIENT_ORIGIN_USER=http://192.168.29.90:5174,http://localhost:5174` — update the IP if this machine's Wi-Fi address changes. |

**Verified:** `node -e` sanity check of `parseOrigins`/`firstOrigin`; backend reboots cleanly with the new require graph (EADDRINUSE against the already-running instance confirms no load-time error); confirmed the active Wi-Fi profile (Public) already has an inbound-allow rule for Node.js. **Not yet confirmed:** an actual phone scanning the regenerated QR (pending user test).

---

## 2026-07-27 — Fix: manual stage-advance to "Interview Scheduled" never sent the interview invite

**What:** `pipelineService.applyTransition` — the function behind the candidate-profile "Move to stage" button and the Hiring Pipeline board — never created an `InterviewQueue` entry or `InterviewSession`. Only the automatic ATS-pass path (`atsService.advanceAfterAtsPass`) did. Added `ensureInterviewInvite()`, firing the same queue-upsert + magic-link-email side effects whenever a manual move lands on `interview_scheduled`. Also fixed `candidateController.moveStage`'s job `.populate()`, which only projected `title` — missing `company`/`interviewInstructions` that session creation needs — and added a dedicated `STAGE_NOTIFICATIONS.interview_scheduled` entry (admin-only) so the generic "status updated" notification doesn't double up against the new invite email.
**Why:** reported — "i did the manual advancement to ats passed and then interview scheduled but it did not come."

**Backend**

| File | Change |
|---|---|
| ✏️ `backend/services/pipelineService.js` | New `ensureInterviewInvite()`, called from `applyTransition`; new `STAGE_NOTIFICATIONS.interview_scheduled` (admin-only). |
| ✏️ `backend/controllers/candidateController.js` | `moveStage`'s job populate expanded to `"title company interviewInstructions"`. |

**Verified:** manually remediated the one candidate already stuck in this state (a one-off script, deleted after use) — confirmed `InterviewSession` created and the invite email dispatched. The code fix itself is not yet exercised via a fresh UI-driven stage move (pending backend restart + manual retest).

---

## 2026-07-27 — Fix: Jobs list always showed "No rubric yet"

**What:** `RoleRubric.aggregate()` (`rubricService.latestStatusesForJobs`, the only rubric-status read the Jobs list uses) always returned zero rows. Root cause: the shared `tenantScope` Mongoose plugin injects `{ $match: { company: tenantId } }` into every aggregate pipeline on a tenant-scoped model — but `tenantId` is a plain string, and Mongoose never casts aggregation `$match` values against the schema (unlike `find`/`findOne` filters), so it could never equal the stored `ObjectId`. Fixed by casting to `mongoose.Types.ObjectId` inside the plugin's `aggregate` hook.
**Why:** reported — most jobs had an approved rubric, but every job showed "No rubric yet".

**Backend**

| File | Change |
|---|---|
| ✏️ `backend/models/plugins/tenantScope.js` | `aggregate` hook casts the injected tenant filter to `mongoose.Types.ObjectId`. |

**Side benefit:** the same bug was silently zeroing `backend/services/quotaService.js`'s `storageMb` usage aggregate whenever it ran inside a tenant request context — fixed for free by the same change.
**Verified:** traced the exact pipeline and confirmed Mongoose's documented no-cast-on-aggregate behavior against the schema's `ObjectId` field. Not yet re-checked live against a page refresh (pending backend restart).

---

## 2026-07-27 — Fix: Review Queue / AI Interviews queue didn't auto-sync with candidate stage changes

**What:** `pipelineService.applyTransition` never touched `ReviewItem` or `InterviewQueue`, so a stage move made from outside their own narrow endpoints (candidate profile page, Hiring Pipeline board) left stale "needs action" entries behind indefinitely. Added `closeSatelliteQueues()`: auto-resolves any open `ReviewItem` and marks the `InterviewQueue` entry `removed` once a candidate leaves `interview_scheduled`. Also, `reviewQueueController`'s "advance" branch mutated the candidate directly without ever broadcasting `candidate:stage` (only "decline" did, via `applyTransition`) — added an explicit `emitStageUpdate` call so an open Hiring Pipeline/profile tab live-updates on an advance too. On the frontend, `ReviewQueue.jsx` and `CompanyDataContext.jsx` (backing `AIInterviews.jsx` + `HiringPipeline.jsx`) had no socket listener at all, only fetching on mount or after their own button click — added a `candidate:stage` listener to each, and removed `HiringPipeline.jsx`'s now-redundant duplicate listener since the shared context handles it centrally.
**Why:** reported — "the review queue should be automatically updated if recruiters update[] the review queue or update[] the candidate to next stage from their profile."

**Backend**

| File | Change |
|---|---|
| ✏️ `backend/services/pipelineService.js` | New `closeSatelliteQueues()`, called from `applyTransition`; `emitStageUpdate` now exported. |
| ✏️ `backend/controllers/reviewQueueController.js` | "Advance" branch now calls `emitStageUpdate` after `advanceAfterAtsPass`. |

**Frontend**

| File | Change |
|---|---|
| ✏️ `admin/src/context/CompanyDataContext.jsx` | New `candidate:stage` socket listener → `load()`, shared by every consumer. |
| ✏️ `admin/src/pages/dashboard/ReviewQueue.jsx` | New `candidate:stage` socket listener → `load()` (doesn't use the shared context). |
| ✏️ `admin/src/pages/dashboard/HiringPipeline.jsx` | Removed its own duplicate `candidate:stage` listener (now centralized in the context). |

**Verified:** traced all call sites of `applyTransition` and every consumer of the `candidate:stage` socket event. Not yet exercised live with two open browser tabs (pending manual test).

---

## 2026-07-27 — Fix: transactional emails silently never delivered (Brevo sender mismatch)

**What:** `MAIL_FROM` was set to the raw Brevo SMTP login (`b149a0001@smtp-brevo.com`) — a valid credential but not a verified sender identity. Brevo accepted every send at the SMTP layer (`EmailLog` recorded `status: "sent"`, no error) and then silently rejected it downstream ("the sender you used ... is not valid"). No transactional email — interview invites, verification, OTP, rejection, welcome — was actually delivered anywhere. Fixed by pointing `MAIL_FROM` at the Brevo-verified sender; documented the gotcha in `.env.example` so it isn't reintroduced.
**Why:** reported — "unable to see [emails] in my mail box ... when giving candidate interview link or giving them verification;" confirmed via the user's Brevo dashboard error log + Senders page.

**Backend**

| File | Change |
|---|---|
| ✏️ `backend/.env` (git-ignored) | `MAIL_FROM` → the Brevo-verified sender address. |
| ✏️ `backend/.env.example` | Added a comment documenting the "SMTP login used as `MAIL_FROM`" Brevo gotcha. |

**Verified:** root cause confirmed via `EmailLog` (all sends showed `status: "sent"`, no application-level error) plus the user's Brevo dashboard screenshots. Not yet re-confirmed by a fresh end-to-end test send (pending).

---

## 2026-07-22 — Product: Live interview proctoring (browser signals + in-browser vision)

**What:** Turned the one-time pre-check into **continuous integrity monitoring during the interview**. Two tiers:
**Tier 1 — browser signals** (no ML, always on): tab-switch, window-blur, fullscreen-exit, copy/paste, right-click, camera-loss. **Tier 2 — in-browser vision** (optional, self-hosted face model): face presence, multi-face, gaze/head-pose "looking away", and **identity match** against the pre-check photo. Every signal feeds a **deterministic, server-computed risk score** surfaced on the admin report + PDF. Enforcement is **warn-live**: the candidate gets a calm on-screen nudge per event; it never blocks or ends the interview. A **consent gate** is required before starting.
**Why:** The "camera check" was only a pre-flight — during the actual interview there was *zero* monitoring (the camera was even stopped), and the identity photo was captured but never matched. This closes the highest-frequency cheat (switching tabs to look answers up) plus the "someone else in the room / not the same person" cases. User asked to complete anti-cheating before platform scaling.

**Design guardrails:** the browser is an **untrusted reporter** — it sends only event *types*; the server owns severity, weights, and the score (a candidate can't forge "low risk"). Vision runs **entirely in the browser** — raw camera frames never leave the device; only derived signals (face count, gaze flag, an identity *distance*) are sent — which keeps candidate biometrics off our infra (DPDP-aligned). Risk is **advisory only** — it never auto-rejects (human-in-the-loop, Wave 4). Chose an **embedded** `proctoring` sub-doc (capped event tail + per-type counts) over a separate `Violation` collection — simpler for pilot scale, same admin surface; a dedicated collection + stored image evidence is the scale/Tier-3 follow-up.

**Backend**

| File | Change |
|---|---|
| 🆕 `backend/utils/proctoring.js` | Event taxonomy + server-owned severity/weight/cap map; deterministic 0-100 risk score (per-type capped weighted sum) + band; meta allow-list sanitizer; report breakdown. |
| ✏️ `backend/models/InterviewSession.js` | New `proctoring` sub-doc: consent, visionEnabled, riskScore/riskBand, per-type counts, identityMatch{status,distance}, capped recent `events` tail. |
| ✏️ `backend/controllers/interviewPortalController.js` | `proctoringConsent` + `proctoringEvents` (batch ingest → server tallies counts, recomputes risk, records identity match; never trusts client severity/score). |
| ✏️ `backend/routes/interviewPortalRoutes.js` | `POST /interview-portal/proctoring/consent` + `/proctoring/events`, candidate-auth + rate-limited (`rl:proctoring:`, 60/min). |
| ✏️ `backend/controllers/candidateController.js` | Report data includes a recruiter-facing `proctoring` summary (risk, identity, consent, breakdown, recent flags); hidden when nothing recorded. |
| ✏️ `backend/services/interviewReportPdf.js` | New "Integrity & Proctoring" PDF section: risk/band, identity check, monitoring on/off, consent, flag breakdown + an "advisory, not proof" note. |

**Frontend**

| File | Change |
|---|---|
| 🆕 `user/src/portal/faceVision.js` | Lazy, **same-origin** loader for face-api (script-injected from `/vendor`, weights from `/models`); frame analysis → face count / descriptor / gaze; euclidean descriptor distance. Fully optional — absent assets ⇒ vision stays off, no build/runtime dependency. |
| 🆕 `user/src/portal/useProctoring.js` | Proctoring engine: Tier 1 DOM listeners + Tier 2 vision loop, per-type debounce, batched flush to the events endpoint, live-warning callback, self-view stream, full teardown. |
| ✏️ `user/src/pages/PreInterviewCheck.jsx` | Required **consent** notice; computes the identity face descriptor from the capture (client-side, best-effort) into sessionStorage; posts consent on confirm. |
| ✏️ `user/src/pages/InterviewRoom.jsx` | Starts/stops monitoring with the interview; live amber **warning banner**; small **"Monitored" self-view** PiP. |
| ✏️ `admin/src/pages/InterviewReport.jsx` | New **Integrity & Proctoring** card: risk gauge, identity-match row, monitoring/consent state, per-flag badges, advisory note. |
| 🆕 `user/scripts/fetch-face-models.mjs` + `user/public/models/README.md` | One-command self-hosted fetch of the face-api bundle + weights (`npm run fetch:face-models`); docs the tiers + graceful degradation. |

**Verified:** `node --check` all changed backend files; proctoring-util smoke (risk 61→high for a mixed event set; meta sanitizer strips unknown fields; breakdown sorted by points; `InterviewSession` schema compiles); `npm run build` passes for **both** admin and user SPAs. **Not exercised live** (no camera/renderer in this env): the in-browser vision loop + the browser→server event round-trip — needs a real browser + camera, and `npm run fetch:face-models` to activate Tier 2. **Deferred:** dedicated `Violation` collection + stored image evidence; secondary-camera + full session recording (Wave 8).

---

## 2026-07-21 — Product: Real-time VOICE interview (Deepgram) + delivery/confidence scoring

**What:** Turned the text-typed AI interview into a **spoken, real-time voice interview**. The candidate hears each question (TTS) and answers by speaking; audio streams live to speech-to-text, and the interview is scored not just on answer content but on **delivery and confidence** measured from how they spoke. Built provider-agnostically behind a `speechService` seam; Deepgram is the demo provider (chosen for speed to demo — a residency-safe swap is a later config change).
**Why:** Voice is the user's top priority — tone/confidence/delivery are core hiring signal a text interview can't capture, and a transcript alone under-represents a candidate. See [[voice-interview-priority]].

**Architecture:** browser ↔ Deepgram directly for STT (short-lived token minted server-side; the API key never reaches the client), backend proxies Aura TTS, and the existing turn-based interview engine (`aiInterviewService`) is unchanged — it simply receives a transcript instead of typed text. The **LLM scores content** (it can't hear audio); **delivery/confidence are measured** from prosody, server-side, so they can't be client-forged.

**Backend**

| File | Change |
|---|---|
| 🆕 `backend/services/speechService.js` | Zero-dep provider seam: mints Deepgram short-lived streaming tokens (`POST /v1/auth/grant`) and proxies Aura TTS (`POST /v1/speak` → MP3). Swap point for a residency-safe provider post-demo. |
| 🆕 `backend/utils/prosody.js` | Deterministic delivery + confidence scoring (0-100) from words/min, filler rate, pause ratio; per-answer + interview aggregate. |
| ✏️ `backend/controllers/interviewPortalController.js` | Added `voiceToken` (GET streaming credential) + `voiceSpeak` (TTS proxy); `submitAnswer` now accepts + sanitises voice metadata (transcript confidence, duration, acoustic measurements). |
| ✏️ `backend/routes/interviewPortalRoutes.js` | `GET /interview-portal/voice/token` + `POST /interview-portal/voice/speak`, candidate-auth + rate-limited. |
| ✏️ `backend/services/aiInterviewService.js` | `submitAnswer(session, text, opts)` attaches voice metadata + a server-derived per-answer delivery score; sets interview `modality`; finalization aggregates delivery/confidence into the evaluation. |
| ✏️ `backend/models/InterviewSession.js` | Turn schema: `inputMode`, `audioPath`, `audioDurationMs`, `transcriptConfidence`, `acoustic{…, deliveryScore}`; interview `modality`; evaluation `delivery` + `confidence`. |
| ✏️ `backend/controllers/candidateController.js` | Report data includes interview `modality` + per-answer `inputMode`/`deliveryScore`. |
| ✏️ `backend/services/interviewReportPdf.js` | PDF shows Format (voice/text) + Delivery/Confidence score bars. |
| ✏️ `backend/.env.example` | Deepgram block (`DEEPGRAM_API_KEY`, STT/TTS models, utterance-end, token TTL). |

**Frontend**

| File | Change |
|---|---|
| 🆕 `user/src/portal/useVoiceInterview.js` | Voice pipeline hook (zero new deps): Deepgram WS streaming STT with live interim captions, Aura TTS via backend proxy (falls back to browser SpeechSynthesis), Web-Audio prosody sampling (pause ratio + energy variance), full teardown. |
| ✏️ `user/src/pages/InterviewRoom.jsx` | Rewritten voice-first: speaks each question then opens the mic, live transcript, "Done answering", barge-in, and an always-available **type-to-answer** fallback so the demo never hard-fails. |
| ✏️ `admin/src/pages/InterviewReport.jsx` | Voice badge, Delivery + Confidence score bars, per-answer delivery, Download-PDF (from the earlier entry). |

**Verified:** `node --check` all changed backend files; require-cascade smoke (speechService disabled-without-key 503, exports wired, new schema paths present); prosody unit check (fluent 99/96 vs hesitant 39/21; aggregate delivery 86 / confidence 90); voice-report PDF renders valid with Delivery/Confidence bars; `npm run build` passes for **both** admin and user SPAs. **Not exercised live** (no `DEEPGRAM_API_KEY`, mic, or browser in this env): the end-to-end streaming STT/TTS round-trip — needs a Deepgram key + a real browser to demo. **Deferred (V5):** voice-consent notice, STT/TTS cost metering, audio retention, and the residency-safe provider swap (Deepgram audio currently leaves India).

---

## 2026-07-21 — Product: CompanySettings admin UI + PDF interview report

**What:** Two product gaps closed. (1) A per-tenant **settings** API + admin screen so a company can self-serve its AI-interview config (model/temperature/monthly budget/hard-cap), DPDP/compliance controls (AI-consent, auto-reject, data-retention days), Data-Protection-Officer contact, recruiter email notifications, and branding — previously only editable in the DB/at provisioning. (2) A **downloadable PDF** of the AI interview report (evaluation scores, summary, strengths/weaknesses, full transcript), generated server-side with a zero-dependency PDF writer.
**Why:** Tenants need to own their own AI/compliance posture without an operator editing Mongo — the retention window, auto-reject toggle, and DPO contact are DPDP-relevant and must be tenant-controlled. Recruiters need a portable, shareable interview record for offline review and hiring-panel/audit trails. The PDF writer is zero-dep (matches the logger/metrics house style) so no heavyweight rendering library is added to the pilot VPS.

**CompanySettings (self-serve tenant config)**

| File | Change |
|---|---|
| 🆕 `backend/controllers/companySettingsController.js` | `getSettings` (upserts a defaults doc so the form is never blank) + `updateSettings` (PATCH-semantics: only supplied fields applied, each validated + whitelisted; enriches the audit trail with `company_settings.update` + changed field list). Company-scoped via `req.user.company` + the tenantScope plugin. |
| 🆕 `backend/routes/companySettingsRoutes.js` | `GET`/`PUT /api/company-settings`, guarded by `requireAuth + requireRole("admin") + requireActiveCompany`. |
| ✏️ `backend/server.js` | Mounted `/api/company-settings`. |
| ✏️ `admin/src/pages/dashboard/SettingsPage.jsx` | Kept the read-only account/company cards; added editable sections — AI Interview, Compliance & Data Protection (with an auto-reject warning), DPO contact, Email Notifications, Branding — with an inline switch component, USD↔cents budget conversion, client-side guards, and a sticky Save. |

**PDF interview report**

| File | Change |
|---|---|
| 🆕 `backend/utils/pdf.js` | Zero-dep PDF 1.4 writer: built-in Helvetica/Helvetica-Bold (real AFM advance-width tables → accurate word-wrap), pagination, WinAnsi transliteration, filled rects (score bars / chat bubbles / header band), horizontal rules, correct xref + stream `/Length`. |
| 🆕 `backend/services/interviewReportPdf.js` | Renders a report object → PDF Buffer: header band, overview, evaluation (overall + per-dimension score bars, summary, strengths/weaknesses/skills), transcript bubbles, confidentiality footer. |
| ✏️ `backend/controllers/candidateController.js` | Extracted `buildInterviewReport(candidateId, companyId)` (shared by JSON + PDF so both render identical data); added `getInterviewReportPdf` streaming `application/pdf` as an attachment. |
| ✏️ `backend/routes/candidateRoutes.js` | Added `GET /:id/interview-report/pdf` (admin-guarded). |
| ✏️ `admin/src/pages/InterviewReport.jsx` | Added a **Download PDF** button (blob fetch → client-side download) shown when an interview exists. |

**Verified:** `node --check` on all changed backend files; require-cascade smoke test (both new controllers/routes load, exports wired). PDF generator validated structurally — generated a multi-page report and confirmed valid `%PDF` header/`%%EOF`, **every xref byte-offset points at its object**, xref `/Size` correct, each stream's declared `/Length` matches actual bytes, and pagination produced 4 pages; the no-interview branch also renders. `npm run build` (admin) succeeds. **Not exercised live:** end-to-end against a running Mongo (save/read round-trip) and opening the PDF in a desktop viewer — no live DB / PDF renderer in this environment.

---

## 2026-07-21 — Wave 6: Performance & observability

**What:** Added compound indexes matched to the real hot query paths (and dropped the redundant single-field indexes they subsume), tuned the Mongo connection pool, and built a zero-dependency observability stack — structured JSON logs with request-id correlation, a Prometheus `/metrics` endpoint, and a load-test script that gates against the SLO. Documented the SLO, metrics catalog, and alert rules.
**Why:** Wave 6 gate — before a nationwide pilot the platform needs predictable query performance under multi-tenant load (indexes/pool), and operators need to *see* latency/errors/throughput per instance and be paged when the SLO is breached. All zero-dependency so the pilot VPS stays simple; the endpoint contracts are drop-in compatible with `prom-client`/pino/a real TSDB at scale.

**Database performance (F11)**

| File | Change |
|---|---|
| ✏️ `backend/models/Candidate.js` | Dropped single-field `{company}`; added `{company, job, createdAt:-1}` (board list), `{company, updatedAt}` (retention scan), `{basicDetails.email}` (dashboard/notification ownership). |
| ✏️ `backend/models/Job.js` | Dropped single-field `{company}`; added `{company, createdAt:-1}` (recruiter list) + `{status, createdAt:-1}` (public job board). |
| ✏️ `backend/models/InterviewQueue.js` | Dropped single-field `{company}`; added `{company, status, atsScore:-1, createdAt}` matching the queue view's filter+sort. |
| ✏️ `backend/models/AdminNotification.js` | Dropped single-field `{company}`; added `{company, createdAt:-1}` (list) + `{company, read}` (unread count). |
| ✏️ `backend/models/Notification.js` | Dropped single-field `{candidate}`/`{user}`; added `{user, createdAt:-1}` + `{candidate, createdAt:-1}`. |
| ✏️ `backend/models/Payment.js` | Dropped single-field `{company}`; added `{company, createdAt:-1}` (billing history). |
| ✏️ `backend/models/Subscription.js` | Added `{status, currentPeriodEnd}` (expiry-reminder cron scan). |
| ✏️ `backend/models/InterviewSession.js` | Added `{status, interviewAt}` (reminder cron scan). |
| ✏️ `backend/models/UsageEvent.js` | Dropped redundant single-field `{company}` (compound `{company, createdAt}` already covers it). |
| ✏️ `backend/models/OTPVerification.js` | Dropped single-field `{email}`; added `{email, purpose, createdAt:-1}` (latest OTP lookup on every verify/resend). |
| ✏️ `backend/config/db.js` | Pool + timeout tuning (`maxPoolSize`/`minPoolSize`/`serverSelectionTimeoutMS`/`socketTimeoutMS`/`maxIdleTimeMS`, all env-tunable); `autoIndex` on in dev, **off in production**; connection-event logging. |
| 🆕 `backend/scripts/syncIndexes.js` | `npm run sync:indexes` — reconciles the DB with the schemas (builds missing, **drops removed** single-field indexes). Deploy step when `autoIndex` is off. |

**Observability**

| File | Change |
|---|---|
| 🆕 `backend/utils/logger.js` | Zero-dep structured JSON logger: levels via `LOG_LEVEL`, `LOG_PRETTY` dev mode, `child()` bindings, deep redaction of password/token/secret/OTP fields. |
| 🆕 `backend/utils/metrics.js` | In-process Prometheus registry: `http_requests_total` counter + `http_request_duration_ms` histogram (by method/route/status) + process gauges; exposition-format `render()`. |
| 🆕 `backend/middleware/observability.js` | `requestContext` assigns `x-request-id` (honoring inbound) + `req.log`, then logs + meters every request on finish using the **matched route pattern** (low cardinality). `metricsEndpoint` serves `/metrics`, `METRICS_TOKEN`-guarded. |
| ✏️ `backend/server.js` | Mounted `requestContext` before cors/routers; added `GET /metrics`; switched the error handler + boot/shutdown logs to the structured logger. |

**Load test & docs**

| File | Change |
|---|---|
| 🆕 `backend/scripts/loadTest.js` | `npm run loadtest` — zero-dep concurrent HTTP generator; reports throughput + p50/p95/p99 and **exits non-zero if the SLO is exceeded** (`SLO_P95_MS`/`SLO_P99_MS`/`SLO_ERROR_RATE_PCT`). |
| 🆕 `OBSERVABILITY.md` | SLO targets, log/metric catalog, Prometheus scrape + alert rules, index table, load-test usage, `sync:indexes` deploy step. |
| ✏️ `backend/package.json` | Added `sync:indexes` + `loadtest` scripts. |
| ✏️ `backend/.env.example` | Added W6 tunables (Mongo pool/timeouts/`autoIndex`, `LOG_LEVEL`/`LOG_PRETTY`, `METRICS_TOKEN`, SLO budgets). |

**Verified:** `node --check` on all changed files; require-cascade + runtime smoke test (logger redaction, metrics counter+histogram render, observability exports, all 10 edited models register with the exact intended index shapes — single-field `{company}` gone, compounds present, unique indexes retained). No frontend changes. **Deferred (ops):** run the 100-concurrent load test on live infra (from a separate host); wire Prometheus/Alertmanager to the shipped alert rules; run `npm run sync:indexes` on the deploy box.

---

## 2026-07-20 — Wave 5: DPDP data-principal rights & security platform

**What:** Added the DPDP rights layer (retention, erasure, portability, DPO contact), an immutable audit trail, rotating refresh tokens with short-lived access tokens (silently refreshed in both frontends), and the remaining HTTP-hardening baseline.
**Why:** Wave 5 gate — the platform must meet DPDP data-fiduciary obligations (retention limits, right-to-erasure/access, named grievance officer, breach-relevant audit logging) and a security baseline (short-lived credentials with server-side revocation, security headers, request timeouts) before onboarding a real paying tenant.

**Security / HTTP hardening (F12)**

| File | Change |
|---|---|
| ✏️ `backend/server.js` | Added `helmet` (security headers, CORP relaxed to `cross-origin` for file/photo loads), `compression`, bounded `express.json({ limit })`, `trust proxy`, and `requestTimeout`/`headersTimeout` (Slowloris protection). Mounted the audit middleware + retention job + `/api/data-rights` router. |
| ✏️ `backend/package.json` | Added `helmet`, `compression`. |

**Audit trail (§5.1)**

| File | Change |
|---|---|
| 🆕 `backend/models/AuditLog.js` | Immutable-by-convention audit record (actor, tenant, action, method/path, resource, status, ip/UA, meta). Global (records platform + candidate + anonymous auth events), indexed by `{company, createdAt}`. |
| 🆕 `backend/middleware/auditLog.js` | `auditLog` middleware logs every **authenticated mutating** request on `res.finish`; `writeAuditLog(...)` helper for explicit security events. Fire-and-forget, never blocks/roars the request. |

**DPDP retention + data-principal rights (§5.2)**

| File | Change |
|---|---|
| 🆕 `backend/jobs/retentionJob.js` | Nightly cron (03:00) hard-deletes candidate PII untouched longer than the tenant's `compliance.retentionDays`. System-context, explicit per-company scoping, capped per run, audit-logged. Disable via `RETENTION_JOB_ENABLED=false`. |
| 🆕 `backend/services/candidatePurgeService.js` | Single source of truth for "everything we hold about a candidate" (resume, identity photo, interview transcript, queue, usage) — used by both the retention job and the erasure endpoint. |
| 🆕 `backend/controllers/dataRightsController.js` | `exportCandidateData` (DPDP-complete access/portability bundle incl. consent + transcript), `eraseCandidateData` (right-to-erasure, audit-logged), `getDpoContact` (public grievance/DPO lookup). |
| 🆕 `backend/routes/dataRightsRoutes.js` | `/api/data-rights` — admin export/erase + public `GET /dpo/:companyId`. |
| ✏️ `backend/models/CompanySettings.js` | Added `compliance.dpo { name, email, phone }`; documented `retentionDays` as job-enforced. |
| ✏️ `admin/src/pages/CandidateDetail.jsx` | Added an **Erase** (DPDP right-to-erasure) action — double-confirmed `api.delete`, returns to the candidate list. |

**Refresh tokens + short-lived access tokens (§5.1)**

| File | Change |
|---|---|
| 🆕 `backend/models/RefreshToken.js` | Hashed, rotating, revocable refresh tokens with a `family` lineage (reuse-detection) + TTL auto-purge. |
| ✏️ `backend/utils/authTokens.js` | Added `generateRefreshToken()` (48-byte opaque token, stored only as SHA-256 hash). |
| ✏️ `backend/controllers/authController.js` | Access token now short-lived (`ACCESS_TOKEN_TTL`, default 2h); `issueTokens` mints access+refresh on login/verify; new `refresh` (rotate + reuse-detection revokes the family) and `logout` (revoke family); login success/failure + refresh-reuse audit-logged. |
| ✏️ `backend/routes/authRoutes.js` | Added `POST /auth/refresh`, `POST /auth/logout`. |
| ✏️ `admin/src/api/client.js`, `admin/src/auth/adminAuth.js` | Silent refresh on 401 (single-flight), token rotation persisted, force-logout on refresh failure; store/rotate the refresh token. |
| ✏️ `admin/src/pages/Login.jsx`, `admin/src/components/dashboard/DashboardShell.jsx` | Persist the refresh token on login; revoke it server-side on logout. |
| ✏️ `user/src/api/client.js`, `user/src/auth/accountAuth.js`, 🆕 `user/src/auth/logout.js` | Same silent-refresh for candidate-account calls **only** (guarded so anonymous + interview-portal calls never trigger an account refresh); `logoutAccount()` revokes server-side. |
| ✏️ `user/src/pages/Login.jsx`, `user/src/pages/VerifyEmail.jsx`, `user/src/components/app/AppNavbar.jsx`, `user/src/pages/Account.jsx` | Persist refresh token; revoke on logout. |
| ✏️ `backend/.env.example` | Documented `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `JSON_BODY_LIMIT`, `REQUEST_TIMEOUT_MS`/`HEADERS_TIMEOUT_MS`, `RETENTION_JOB_ENABLED`, `RETENTION_MAX_PER_RUN`. |
| ✏️ `backend/worker.js` | Retention job runs in the dedicated worker (and in the API when it hosts workers). |

**Verified:** backend `node --check` on all changed files + require-cascade load of every new module; admin Vite build (2395 modules) and user Vite build (2307 modules) both pass.
**Deferred (documented in STATUS.md):** encryption-at-rest (LUKS/MinIO SSE) + secrets manager are **infra/ops** (section D); httpOnly-cookie storage for refresh tokens (SPAs use localStorage Bearer today — rotation + revocation is the meaningful upgrade); a **CompanySettings admin UI** to edit `ai`/`compliance`/`dpo`/`retentionDays` (no settings controller exists yet — ops sets these via provisioning/DB); apply-form DPO link (public endpoint exists).

---

## 2026-07-20 — Wave 4: Compliance & AI governance

**What:** Made AI-driven hiring decisions consent-backed, auditable, bias-mitigated, and non-adverse-by-default.
**Why:** Audit flagged legal/fairness exposure — auto-rejection with no human review, the candidate name in the scoring prompt, prompt injection into the evaluation, PII to a global LLM with no consent, and a length-based fallback driving recommendations.

| File | Change |
|---|---|
| ✏️ `backend/utils/interviewPrompts.js` | Fenced untrusted candidate text in `<candidate_data>` tags + system-prompt injection defense (F9); `buildContext(..., { blind })` omits the candidate name; evaluation prompt forbids protected-characteristic inference (bias); added `PROMPT_VERSION`. |
| ✏️ `backend/models/InterviewSession.js` | Evaluation provenance fields (`model`, `provider`, `promptVersion`, `temperature`, tokens, `latencyMs`); per-turn `engine`/`model`/`latencyMs`; `recommendation` enum gains **`review`** (F13). |
| ✏️ `backend/services/aiInterviewService.js` | Evaluation is **bias-blinded**; fallback recommendation is always **`review`** (never adverse — 6.4); provenance stamped on evaluation + turns. |
| ✏️ `backend/services/atsService.js` | ATS auto-reject now gated on `compliance.autoRejectAllowed` — **human-in-the-loop** by default (no status change, no rejection email; admin notified to review) (F7). |
| ✏️ `backend/models/Candidate.js` | Added `consent { aiProcessing, dataProcessing, at, ipAddress }` (DPDP). |
| ✏️ `backend/controllers/candidateController.js` | `applyToJob` captures consent flags + IP. |
| ✏️ `user/src/pages/ApplyForm.jsx` | Consent section: required data-processing consent + optional AI-interview consent. |
| ✏️ `backend/models/CompanySettings.js` | Added `compliance { aiConsentRequired, autoRejectAllowed, retentionDays }`. |

**Verified:** `node --check` + load; schema validation (recommendation `review`, provenance, consent, safe defaults `aiConsentRequired:true` / `autoRejectAllowed:false`); user Vite build (2306 modules).
**Note:** LLM residency (6.1) minimum is met by keeping PII local when consent is absent; pinning zero-retention OpenRouter routing + a signed DPA remains an operational config step.

---

## 2026-07-20 — Wave 3: LLM safety & per-tenant cost control

**What:** Hardened the LLM path so one tenant or one abusive token can't hang the app or run up unbounded spend.
**Why:** Audit found the LLM call had no timeout/retry, the slow evaluation blocked the candidate's last request, there were no per-tenant cost caps, and the hot endpoints were unthrottled.

| File | Change |
|---|---|
| ✏️ `backend/services/llmService.js` | Added a hard **timeout** (`AbortSignal.timeout`), bounded **retry/backoff** on 408/429/5xx honoring `Retry-After`, `usage`-cost capture, and per-call `model`/`temperature` overrides. Returns `{ data, usage, model }`. |
| ✏️ `backend/models/CompanySettings.js` | Added per-tenant `ai { model, monthlyBudgetCents, hardCap, temperature }`. |
| 🆕 `backend/models/UsageEvent.js` | Per-call metering record (tenant-scoped) — cost attribution + AI-decision audit trail. |
| 🆕 `backend/services/usageService.js` | `recordUsage`, `monthToDateCents`, `isOverBudget` (month-to-date vs tenant cap). |
| ✏️ `backend/services/aiInterviewService.js` | Threads per-tenant config; **meters every LLM call**; gates the real engine on key + consent + budget; **detached evaluation** (off the request path); context per interview. |
| 🆕 `backend/middleware/rateLimit.js` | Limiter factory (Redis store when available, else memory), keyed by interview candidate. |
| ✏️ `backend/routes/interviewPortalRoutes.js` | Rate limits on `POST /interview/answer` (20/min), `GET /speed-test-file` (10/min), `POST /login` (20/min). |
| ✏️ `backend/.env.example` | Documented `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`. |
| ✏️ `backend/package.json` | Added `rate-limit-redis`. |

**Verified:** `node --check` + full load; `llmService` disabled path throws `LLM_DISABLED`; budget/config schema validates. **Not tested:** live OpenRouter timeout/retry/metering (needs a real key).

---

## 2026-07-20 — W9: Admin AI-interview report review

**What:** A recruiter-facing screen + API to review a candidate's AI interview (transcript, evaluation, recommendation) and act on it (shortlist / reject / next round).
**Why:** The AI interview ran and stored results but nothing surfaced them — recruiters couldn't see or act on interviews. Closes the loop of the ATS → interview → decision flow.

| File | Change |
|---|---|
| ✏️ `backend/controllers/candidateController.js` | Added `getInterviewReport` — curated, tenant-scoped payload (candidate, job, transcript, evaluation, provenance, allowed next stages). Never exposes the session `tokenHash`. |
| ✏️ `backend/routes/candidateRoutes.js` | Added `GET /:id/interview-report` (admin, active-company). |
| 🆕 `admin/src/pages/InterviewReport.jsx` | New review screen: score bars (overall/communication/technical/problem-solving), recommendation badge, strengths/weaknesses/skills-to-probe, full transcript, one-click decision buttons + note. Live-refresh on `candidate:stage` socket event. |
| ✏️ `admin/src/App.jsx` | Imported `InterviewReport`; added route `/candidates/:id/interview-report`. |
| ✏️ `admin/src/pages/CandidateDetail.jsx` | Added an **AI Report** link in the header; imported `Sparkles` icon. |
| ✏️ `admin/src/pages/dashboard/AIInterviews.jsx` | Added a **Report** action per row; imported `Sparkles` icon. |

**Verified:** backend `node --check` + require-cascade load; admin Vite build passes (2395 modules).

---

## 2026-07-20 — Wave 2: Multi-instance safety (scale hardening)

**What:** Made the backend safe to run as more than one instance behind a load balancer.
**Why:** Audit found three correctness breakages the moment a 2nd instance starts — dropped real-time events, duplicate reminder emails, and local-disk files invisible across instances (which silently made ATS score empty text). Plus operational hardening (env validation, graceful shutdown, readiness).

| File | Change |
|---|---|
| 🆕 `backend/services/storageService.js` | Pluggable file storage: **S3/MinIO** when configured, **local-disk fallback** otherwise. `putObject` / `getObjectBuffer` / `sendDownload` / `deleteObject` + tenant-partitioned keys. Reads legacy absolute disk paths too (no data migration needed). Fixes F4. |
| ✏️ `backend/middleware/upload.js` | Switched apply-route multer from diskStorage → **memoryStorage** so the buffer can go through storageService. |
| ✏️ `backend/controllers/candidateController.js` | `applyToJob` now `putObject`s the resume with a tenant key; `downloadResume` uses `sendDownload`. |
| ✏️ `backend/services/atsService.js` | Resume read now via `storageService.getObjectBuffer` (works across instances). |
| ✏️ `backend/controllers/resumeController.js` | Resume-library upload/download via storageService; removed local `fs`/`STORAGE_DIR`. |
| ✏️ `backend/controllers/interviewPortalController.js` | Identity-photo upload via storageService; removed local `fs`/`path`/dir. |
| ✏️ `backend/config/redis.js` | Added `getRedisPubSub()` — dedicated pub/sub client pair for the Socket.io adapter. |
| ✏️ `backend/config/socket.js` | Wired **`@socket.io/redis-adapter`** when Redis present (multi-instance real-time); warns when absent. Fixes F2. |
| 🆕 `backend/config/env.js` | `validateEnv()` — fail-fast at boot; **Redis required in production**; warns on missing S3/CORS/OpenRouter. |
| ✏️ `backend/jobs/interviewReminderJob.js` | **Atomic claim-before-send** (`findOneAndUpdate` flag flip) so reminders never double-send; wrapped in `runAsSystem`. Fixes F3. |
| ✏️ `backend/jobs/subscriptionExpiryJob.js` | Same atomic-claim pattern + `runAsSystem`. |
| 🆕 `backend/worker.js` | Dedicated background-worker entrypoint (email queue + cron) for multi-instance prod, with graceful shutdown. |
| ✏️ `backend/server.js` | Calls `validateEnv()`; added `/api/ready` readiness probe (Mongo+Redis); runs workers only when `RUN_WORKERS_IN_API !== "false"`; added **graceful shutdown** (SIGTERM/SIGINT → drain http/sockets/worker/db). Fixes F5, F12(part). |
| ✏️ `backend/package.json` | Added `worker` script; deps `@aws-sdk/client-s3`, `@socket.io/redis-adapter`. |
| ✏️ `backend/.env.example` | Documented `NODE_ENV`, S3/MinIO (`S3_*`), `RUN_WORKERS_IN_API`, `TENANT_GUARD_STRICT`. |

**Verified:** all changed files `node --check`; full require-cascade loads; env-validation behavior tested (dev pass / missing-secret throw / prod-no-Redis throw / prod-with-Redis pass).
**Not yet tested:** live multi-instance run (needs Redis + MinIO). Switching to S3 does **not** migrate existing local files (fresh-deploy assumption).

---

## 2026-07-20 — Wave 1: Tenant isolation & correctness

**What:** Hardened shared-DB multi-tenancy with a defense-in-depth guardrail + closed the concrete isolation gaps the audit found.
**Why:** Isolation was already good (companyId from JWT/DB), but relied on every query remembering its `company` filter. Added a safety net so a forgotten filter fails safe, and fixed a real cross-tenant leak.

| File | Change |
|---|---|
| 🆕 `backend/utils/tenantContext.js` | `AsyncLocalStorage` tenant context: `run` / `runAsSystem` / `getTenantId` / `isSystem`. |
| 🆕 `backend/models/plugins/tenantScope.js` | Mongoose plugin: auto-injects `{ company: <tenantId> }` on tenant-model queries when a tenant is in context; asserts `company` on save; optional strict mode (`TENANT_GUARD_STRICT`). |
| ✏️ `backend/models/{Job,Candidate,InterviewSession,InterviewQueue,AdminNotification,Payment,Invoice,Subscription,Workspace,CompanySettings}.js` | Attached the `tenantScope` plugin (10 tenant-scoped models). |
| ✏️ `backend/models/EmailLog.js` | Added optional `company` field (per-tenant audit prep). |
| ✏️ `backend/middleware/auth.js` | `requireAuth` runs the request inside a tenant context; added `optionalAuth` (public routes that show owner-only data) and `requireActiveCompany` (per-request suspension/payment gate). Fixes F10. |
| ✏️ `backend/controllers/jobController.js` | `getJob` returns 404 for unpublished jobs unless the owning admin. Fixes F1 (cross-tenant draft-job leak). |
| ✏️ `backend/routes/jobRoutes.js` | `GET /:id` uses `optionalAuth`; admin routes gated by `requireActiveCompany`. |
| ✏️ `backend/routes/candidateRoutes.js` | Admin routes gated by `requireActiveCompany`. |
| ✏️ `backend/routes/interviewQueueRoutes.js` | Admin routes gated by `requireActiveCompany`. |
| ✏️ `backend/routes/interviewSessionRoutes.js` | Admin route gated by `requireActiveCompany`. |
| ✏️ `backend/controllers/paymentController.js` | Billing lookups return **404 not 403** on foreign id (no existence oracle). Fixes F14. |
| ✏️ `backend/controllers/candidateDashboardController.js` | `toggleSavedJob` is published-only. Fixes F14. |
| ✏️ `backend/services/emailDispatchService.js` | Threads optional `company` into `EmailLog`. |

**Verified:** models compile with the plugin; guardrail injection tested through Mongoose's real hook machinery (tenant present → scoped; explicit filter preserved; system/no-context → untouched); tenantContext behavior tested.

---

## 2026-07-20 — Multi-tenant production-readiness plan (analysis)

**What:** Four-lens code audit (tenant-isolation/security, architecture/scale, ML/LLM, computer-vision/proctoring) → a phased plan to run this as a multi-tenant SaaS (pilot → nationwide, India DPDP, self-hosted).
**Why:** Requested a "foolproof" plan to hand a company.

| File | Change |
|---|---|
| 🆕 `MULTI-TENANT-PLAN.md` | Locked decisions + SLOs, current posture, target architecture, tenancy hardening, scale/reliability, DPDP compliance, AI governance, proctoring, 9-wave roadmap, go-live checklist. Updated to mark W1/W2/W9 shipped. |

---

## 2026-07-20 — AI Interview Engine → OpenRouter

**What:** Switched the LLM provider from the Anthropic SDK to **OpenRouter** (OpenAI-compatible), keeping the `generateJSON` interface and the keyless fallback.
**Why:** User wants to use an OpenRouter key.

| File | Change |
|---|---|
| ✏️ `backend/services/llmService.js` | Rewritten to call OpenRouter Chat Completions via native `fetch` (no SDK). Structured output via `response_format` json_schema; robust JSON parsing; `thinking→reasoning.effort`; keyless fallback preserved. |
| ✏️ `backend/.env.example` | Replaced Anthropic vars with `OPENROUTER_API_KEY`, `AI_INTERVIEW_MODEL` (default `openai/gpt-4o-mini`), `OPENROUTER_BASE_URL`, `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME`. |
| ✏️ `backend/package.json` · `package-lock.json` | Removed the now-unused `@anthropic-ai/sdk` dependency. |
| ✏️ `IMPLEMENTATION-PLAN.md` | Provider references updated (Claude/Anthropic → OpenRouter). |

**Verified:** module loads; `isEnabled()` false without key / true with key; disabled path throws `LLM_DISABLED` (fallback trigger). **Not tested:** live OpenRouter request (needs a real key).

---
