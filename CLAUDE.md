# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# PRODUCT THESIS — read before planning anything

**This platform is not another ATS with an LLM bolted on. That product already exists and it is bad.**

The owner is building this specifically to be *different from what everyone else is doing*. Every planning
decision, architecture choice, and feature scope call must be made against that goal. Treat the sections
below as binding product constraints, not aspirations.

## The differentiation discipline (ask this every time)

Before proposing **any** plan, design, feature, or refactor, Claude must explicitly answer these three
questions in its response — not silently, not "considered it", written out:

1. **What does everyone else do here?** (keyword ATS, embedding-similarity match scores, "LLM emits a
   0–100", HireVue-style video scoring, Eightfold-style skill graphs — name the incumbent approach.)
2. **Why is that approach weak?** (unauditable, non-reproducible, gameable, generic, uncalibrated,
   legally indefensible under NYC Local Law 144 / EU AI Act Annex III high-risk employment rules.)
3. **What do we do instead, and what value does that create that a buyer can feel?** If the answer is
   "the same thing but with a better model," the plan is rejected — go back and find the different thing.

If a proposed feature cannot survive those three questions, do not build it. Say so and propose the
version that can.

## Non-negotiable AI engineering rules

These exist because the product's entire claim is *trustworthy* AI evaluation. Violating one of them
turns us back into a commodity LLM wrapper.

1. **The model never emits the score. Code computes the score.** LLMs are used for *extraction and
   reasoning over text* ("what does this document claim, and where does it say so"). All arithmetic,
   weighting, thresholding, and pass/fail decisions happen in deterministic JavaScript over the model's
   structured output. This is what makes a score reproducible, auditable, and defensible in a
   discrimination claim. Any code path where an LLM returns a number that becomes a candidate's score
   directly is a bug.
2. **Cite or abstain.** Every extracted fact must carry verbatim character spans from the source
   document. Code verifies each span is a literal substring of the source. A fact that cannot be cited
   is dropped, not trusted. This eliminates hallucination structurally instead of hoping the model
   behaves.
3. **No generic evaluation, ever.** No candidate is scored against a global average, a generic
   "good engineer" prior, or the model's opinion of a good résumé. Every judgement is relative to an
   explicit, versioned, human-approved rubric for *this* role at *this* company, and every output names
   the specific criterion and the specific evidence that drove it.
4. **Disagreement is a routing signal, not noise.** When repeated extractions disagree, that means the
   input is ambiguous. Route it to a human. Never average conflicting readings into a falsely confident
   number.
5. **Uncertainty must be visible.** Degraded/fallback/no-key paths must be labelled as such everywhere
   they surface (screen, PDF, API). Never render a placeholder as if it were a measurement. The existing
   fallback engine already does this correctly — match that standard.
6. **Every automated adverse action needs a human.** Auto-reject stays opt-in and default-off. The
   deterministic fallback must never emit an adverse recommendation.
7. **Assume the input is hostile.** Résumés are adversarial documents: prompt injection, invisible
   keyword stuffing, LLM-generated filler. Defend explicitly and log what was detected.

## What we are building toward (the differentiated core)

The headline mechanism is the **Claim → Probe → Verdict loop**, which makes screening and interviewing
*one system* rather than two disconnected products:

- The JD is compiled once into a **versioned, recruiter-approved `RoleRubric`** — explicit must-haves,
  nice-to-haves, disqualifiers, weights. Every candidate for that role is scored against the identical
  frozen rubric, which is what makes cross-candidate comparison legitimate and a bias audit possible.
- The résumé is decomposed into an **evidence-bound `ClaimGraph`** — atomic, individually-cited,
  individually-confidence-scored claims, rather than a blob of matched keywords.
- Screening output is **not a verdict, it is a test plan.** High-weight claims the résumé asserts but
  cannot prove become **interview probes**. The AI interview then tests exactly those claims, and the
  final report closes the loop by marking each one verified, contradicted, or still unverified.
- Scores are **calibrated against this tenant's own outcomes**, so a number means "candidates like this
  advanced past HR 42% of the time here", not an abstract 78/100.

Nobody in this market ships that loop. It is the reason to buy.

See [BUILD-PLAN.md](BUILD-PLAN.md) for the sequenced implementation plan (one phase at a time, with
per-phase guardrails and acceptance gates). [STATUS.md](STATUS.md) is the accurate record of what is
built; **[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) is stale and understates what exists — do not
plan from it.**

---

## What this is

An AI-branded recruitment/hiring platform split into **three independently-run apps**, each with its own `package.json` (there is no root workspace tooling — install and run each separately):

- **`backend/`** — Express + MongoDB (Mongoose) REST API + Socket.io, port **9000**. CommonJS.
- **`admin/`** — React 18 + Vite SPA for companies/recruiters, port **5173**. ESM.
- **`user/`** — React 18 + Vite SPA for candidates, port **5174**. ESM.

Both frontends use React Router v6, Tailwind v4 (`@tailwindcss/vite`), axios, react-hook-form + zod, framer-motion, lucide-react, and socket.io-client. There is no test suite and no linter configured.

## Commands

Infrastructure runs via Docker (repo-root `docker-compose.yml`); apps run from their own directories.
`backend/.env` holds the real keys (git-ignored) — `.env.example` is the documented template that
`npm run check:env` validates against.

```bash
# Infra first (Mongo + Redis + MinIO with bucket init). MinIO's S3 API is on host :9100
# because the backend owns :9000 → S3_ENDPOINT=http://127.0.0.1:9100 in backend/.env.
docker compose up -d
docker compose --profile app up -d   # optional: backend containerised too (backend/Dockerfile)

# backend/ (against the dockerized infra)
npm install
npm run dev            # nodemon server.js
npm start              # node server.js (prod)
npm run seed:plans     # seed SubscriptionPlan docs — run once before testing billing

# admin/  and  user/  (same scripts in each)
npm install
npm run dev            # vite on 5173 (admin) / 5174 (user)
npm run build
npm run preview
```

There are no tests. To smoke-test end to end: start backend + both frontends, then exercise login + one API call + a socket feature (live notifications).

## Critical environment / config facts

Copy `backend/.env.example` → `backend/.env`. **`.env.example` is incomplete** — several required/important vars are read by code but not listed there:

- **Two separate JWT secrets, not one** (mixing them up breaks auth silently):
  - `AUTH_JWT_SECRET` — signs **User account** tokens (admins, companies, candidate dashboard accounts) and the Socket.io handshake. Used in `middleware/auth.js`, `config/socket.js`, `authController.js`, `companyAuthController.js`.
  - `JWT_SECRET` — signs **interview-portal** tokens (magic-link → session, tied to an `InterviewSession`, not a `User`). Used in `middleware/candidateAuth.js`, `interviewPortalController.js`.
- `ADMIN_SIGNUP_KEY` — gates admin self-signup in `authController.js`.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — payments/webhook signature.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` — email. **If `SMTP_HOST` is unset, `mailer.js` uses nodemailer `jsonTransport`: emails are composed but never sent — only logged to the backend console.** This is the #1 "OTP/verification email never arrives" gotcha; read the code straight from the terminal, or configure SMTP.
- `REDIS_URL` — optional. If set, email goes through a BullMQ queue with retries; if unset, email sends inline with one manual retry.
- Tunables with defaults: `INTERVIEW_SCHEDULE_DELAY_DAYS` (3), `INTERVIEW_SCHEDULE_HOUR_UTC` (11), `INTERVIEW_LINK_VALIDITY_HOURS` (48), `SUBSCRIPTION_EXPIRY_REMINDER_DAYS` (7).

**Ports & CORS must agree.** Backend CORS + Socket.io only allow `CLIENT_ORIGIN_ADMIN` (5173) and `CLIENT_ORIGIN_USER` (5174) exactly. If Vite falls back to another port (e.g. 5175 because a stale process holds 5173), the browser's requests are rejected by CORS. Frontends default their API base to `http://localhost:9000/api` but `VITE_API_URL` in `admin/.env` / `user/.env` overrides that and silently wins if it points elsewhere. See `dev-notes-port-migration-and-otp-fix.md` for the full history of the 5000→9000 migration.

## Architecture — the parts that span multiple files

**Three separate identity systems** (each with its own localStorage key, auth flow, and — for two of them — its own JWT secret):

1. **Admin/recruiter** — `User` with `role: "admin"`, localStorage `adminAuth`, secret `AUTH_JWT_SECRET`. Guards routes with `requireAuth` + `requireRole("admin")`.
2. **Candidate account** — `User` with `role: "candidate"`, storage `candidateAccountAuth` (localStorage *or* sessionStorage depending on "remember me"), secret `AUTH_JWT_SECRET`. This is the optional dashboard login.
3. **Interview portal** — no `User` at all. A magic link (`/interview/:token`) is exchanged in `interviewPortalController.login` for a short-lived JWT tied to an `InterviewSession`, stored as `interviewPortalAuth`, verified by `requireCandidateAuth` with `JWT_SECRET`. Token expiry is derived from the session's `expiresAt`.

**Role model (reconciled in Phase 16.6):** `superadmin` = **platform staff** (no company, operates every tenant); `admin` = **company recruiters** (one tenant). The seed path for the first platform account is `POST /api/auth/admin/register` gated by `ADMIN_SIGNUP_KEY` — it mints `superadmin` only; company admins are only ever created by the company-registration + subscription flow. In the admin SPA, `RequireAdmin` routes superadmins to `/platform` (the Phase 16 console behind `requireRole("superadmin")` + `PLATFORM_CONSOLE_ENABLED`); "view as tenant" is **read-only server-side** — `requireAuth` rejects any non-GET carrying the `X-View-As-Company` header. Rubric/assessment immutability binds superadmins too: platform staff can suspend a tenant, never touch a score.

**`Candidate` vs `User` are different things and only linked by email.** A `Candidate` document is the (anonymous) job application, created on submit. A `User{role:"candidate"}` is an optional registered account. Notification code repeatedly does `User.findOne({ email: candidate.basicDetails.email, role: "candidate" })` to see if a real-time socket target exists — anonymous applicants get **email only**, registered ones also get in-app + socket push.

**ATS scoring is currently deterministic keyword matching, not an LLM** — and that is exactly what
[BUILD-PLAN.md](BUILD-PLAN.md) Phases 2–6 replace with the evidence-bound Claim → Probe → Verdict engine
described in the Product Thesis above. Until that lands, `atsEngine` remains the live scorer and, after
it lands, survives as the cheap deterministic pre-filter and the no-key fallback prior. Current flow:
candidate applies (`candidateController.applyToJob`) → `atsService.runAtsForCandidate` reads the resume file, extracts text (`extractResumeText` via pdf-parse/mammoth, with magic-byte type detection in `verifyFileSignature`), then `atsEngine.computeAtsScore` produces a weighted keyword/skills/experience/education/projects/certification score. **Pass** (≥ `job.atsThreshold`, default 60) → status `interview_queue`, upserts `InterviewQueue`, and `createInterviewSessionIfNeeded` mints a magic-link session + invitation email. **Fail** → status `rejected` + rejection email. This runs synchronously on apply and can be re-triggered via `POST /api/candidates/:id/ats/rerun`. Session creation is **idempotent** — re-running ATS never re-mints or resends an existing interview link.

**All notifications funnel through `services/notificationService.js`** (`notifyCandidate` / `notifyAdmin`). Each call does up to three things, gated by the recipient's `NotificationPreference`: (1) write a `Notification`/`AdminNotification` doc, (2) emit a Socket.io event to the right room, (3) dispatch a templated email. Email always goes through `emailDispatchService.dispatchEmail`, which first writes an `EmailLog` audit row, then either enqueues to BullMQ (if `REDIS_URL`) or sends inline. Never call `mailer.sendMail` directly for notifications — go through this hub so preferences, logging, and templates are applied.

**Socket.io** (`config/socket.js`) authenticates on the handshake with `AUTH_JWT_SECRET` and joins each connection to a room: admins → `company:{companyId}`, candidate accounts → `candidate:{userId}`. Server code emits via `emitToCompany` / `emitToCandidateUser`.

**Payments (Razorpay).** The webhook route is registered in `server.js` **before** `express.json()` with a raw-body parser, because signature verification needs the exact original bytes — do not move it below the JSON middleware. On successful payment, `workspaceProvisioningService.provisionWorkspace` upserts `Subscription` + `Workspace` + `CompanySettings` and flips the company to `active`.

**Company onboarding is a distinct flow** from admin login: register company → 6-digit email OTP (`OTPVerification`, rules in `utils/otp.js`: 6 digits, 10-min expiry, 5 attempts, 45s resend cooldown, 5 sends/hour) → verify → provision. Handled by `companyAuthController` + `services/companyRegistrationService.js`.

**Background jobs** are started inline from `server.js` after DB connect: `startEmailWorker` (BullMQ consumer), `startInterviewReminderJob` (node-cron every 15 min; sends 24h + 1h reminders, each guarded by a per-session sent-flag), `startSubscriptionExpiryJob`.

### Backend layout convention

`server.js` → `routes/` (Express routers, attach auth middleware) → `controllers/` (HTTP handlers) → `services/` (cross-cutting orchestration: ATS, notifications, email dispatch, provisioning, invitations) → `models/` (Mongoose) and `utils/` (pure helpers: `atsEngine`, `otp`, `authTokens`, `emailTemplates`, `passwords`, `validators`, `slug`, `verifyFileSignature`). Keep multi-step / multi-model logic in `services/`, not controllers. The global error handler in `server.js` turns any thrown error into a `400 { error }`, so controllers can `throw` freely.

### Frontend convention (both apps mirror each other)

`api/client.js` = a preconfigured axios instance (admin's version injects the bearer token and redirects to `/login` on 401). `auth/*` = localStorage-backed auth store + a `Require*` route guard. `context/` = React context providers (notifications, and in admin `CompanyDataContext`). `lib/socket.js` = socket.io-client wired to `VITE_API_URL`. `pages/` = route components; `pages/dashboard/` (admin) = authed dashboard screens.
