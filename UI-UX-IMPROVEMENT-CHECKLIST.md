# UI/UX Improvement Checklist — Whole Platform

_Short-form action list distilled from [PLATFORM-EXPERIENCE-AUDIT.md](PLATFORM-EXPERIENCE-AUDIT.md)
(which has the file:line evidence for every item). Tick items as they land._

---

## PART A — THINGS THAT MUST BE ADDRESSED (prioritized)

### 🔴 P0 — Blockers (product doesn't work as sold)

- [x] **Settings → add ATS engine selector** (legacy / shadow / live) — landed 2026-07-27: "Screening Engine" card in Settings + `ai.atsEngine` whitelisted in `companySettingsController`
- [x] **JobForm → add scoring fields** — landed 2026-07-27: skills/experience/education/threshold/interview bounds/instructions on JobForm, with a no-criteria warning; job create now routes to the rubric screen
- [x] **Stop candidate data leak** — landed 2026-07-27: curated serializers (`utils/candidateSerializers.js`) on candidate-dashboard + apply now returns a lean receipt; stage-history notes/actor and all internals withheld
- [x] **Fix 401 resume download + candidate export** — landed 2026-07-27: bearer blob download helper (`admin/src/lib/download.js`); Rescore also unhidden for evidence-scored candidates
- [x] **Add "Continue interview" button** for `in_progress` sessions — landed 2026-07-27, plus a real `completed` state on the portal dashboard
- [x] **Add recovery path for expired-mid-interview** — landed 2026-07-27: resend/reschedule now allowed when the link expired mid-interview (interview resumes with answers intact); only a *live* valid-link attempt or a completed interview stays blocked
- [x] **Remove screen-share pre-check** + **warn mobile users early** — landed 2026-07-27: screen-share check deleted (client+server), fullscreen now best-effort, mobile banner on pre-check, laptop guidance in portal dashboard + invitation email
- [x] **Email deliverability** *(code half)* — landed 2026-07-27: OTP/verification/password-reset now go through the audited dispatch path (EmailLog + retries); failed sends alert tenant admins in-app and log loudly. **Ops still required:** verified sender domain in `MAIL_FROM` (gmail-on-Brevo will still be dropped).
- [x] **Make ATS async on apply** — landed 2026-07-27: 201 returns the moment the Candidate is stored; notifications + screening run in a contained background pipeline with admin alert on failure
- [x] **Fix link base URLs** *(code half)* — landed 2026-07-27: new `PUBLIC_CANDIDATE_URL` env wins over CORS-origin ordering for all emailed candidate links (interview, reset, phone QR). **Ops still required:** set it (and `PUBLIC_BASE_URL`) to real domains in production.
- [x] **Duplicate-application guard** — landed 2026-07-27: unique (job, email) index + 409 pre-check + double-click guard + apply email bound to the signed-in account (form field now read-only)
- [x] **Rate-limit `POST /apply`** (10/15min per account) · reject `.doc` at upload with an actionable message · admin alert when a resume yields no extractable text — all landed 2026-07-27

### 🟠 P1 — Trust, legal, coherence

- [ ] **Fix Rule-1 violation in the interview**: LLM currently emits the 0–100 score + hire/no-hire directly; replace with rubric-bound judgments aggregated by the deterministic scorer
- [ ] **Candidate outcome communication**: rejection email with reason + DPO contact; "in review" status instead of indefinite silence; interview-completion confirmation email
- [ ] **Timezone-correct email times** (with zone label) + include the interview link in reminder emails
- [ ] **Kill the fake countdown/schedule** — either real slot booking or honest "complete anytime before {expiry}"
- [ ] **Build team invites / seat management** — sold on pricing page, doesn't exist; every company is one user forever
- [ ] **Fix contradictory displays**: legacy breakdown tiles under evidence headline score · rubric banner false-alarms after JD edit · Reports "evidence" badge over legacy decisions in shadow mode · audit pack ignoring date range
- [ ] **Payments**: call cancel endpoint on Razorpay dismissal (retry currently always 400s); fix "null plan (null)" description; add invoice/billing history screen; surface grace-period state
- [ ] **Quota UX**: show usage meters (API exists, never called); parse `QUOTA_EXCEEDED` payloads into friendly messages
- [ ] **Turn on the built-but-disabled safety machinery** after an eval run: ensemble self-consistency, QA gate enforce mode; widen counterfactual probe beyond one fixed name

### 🟡 P2 — Competitiveness / USP

- [ ] **Candidate interview receipt** (post-interview: what was covered, verified claims, next steps + SLA) — the landing page already promises this
- [ ] **Pre-interview probe preview** ("this interview will focus on YOUR resume claims") — nobody in the market does this
- [ ] **First live-LLM eval run** over the golden set + recorded fixtures (today zero real model output has passed through the pipeline in test)
- [ ] Notification click-through, review-queue history/SLA, pipeline board rework, CSV exports, global search

---

## PART B — UI/UX NOTES, SCREEN BY SCREEN

### Candidate app (`user/`)

**Job listings & detail**
- No search, filters, sort, or pagination — raw list of every tenant's jobs mixed together
- Job detail missing salary, employment type, posted date, apply-by date
- Listings error state has no Retry button (detail page has one — inconsistent)
- Landing-page promises (match score, post-interview report, profile prefill, "interview whenever suits you") are all unbuilt — align copy or build them

**Apply form**
- Nothing prefilled from the logged-in account; saved resume library can't be reused — must re-attach a file
- Zero field-level validation (component imported but never used); errors show only as one top banner; no scroll-to-error
- File zone: no drag-and-drop, 5 MB limit never shown, label says "PDF or DOCX" while accepting `.doc`
- Experience/education dates are free-text — use date pickers
- Success screen too thin: no reference ID, no dashboard link, no "what happens next" timeline

**Auth & candidate dashboard**
- Register: no password strength meter, no confirm-password, no show/hide; success icon implies an email step that doesn't exist; no auto-login after register
- Any fetch error force-logs the user out ("session expired") — should only be 401
- Profile save / save-job / mark-read failures are silent no-ops — add toasts
- Profile-completion % criteria never explained
- Upcoming-interview card has no link/button to the interview — candidate must dig through email
- Raw status strings (`completed`, `expired`) and raw notification types rendered as UI copy — humanize all labels
- `/account` unreachable from nav; no password change, no notification preferences (API exists), no self-service data export/erasure
- Notification search fires on every keystroke — add debounce

**Interview portal**
- Magic-link landing + portal dashboard sit inside the marketing shell (nav = exit risk) — move into the focused portal shell
- Link-error screen has no support contact
- Portal dashboard: `completed` renders an empty action area + raw badge; `in_progress` shows text with no continue button; live magic link printed in plaintext; countdown is decorative
- Pre-check: mic check has no level meter (muted mic passes); speed test enforces no minimum; identity photo is one-shot with no preview/retake; consent decline path missing (backend supports it); quota 429 shows billing jargon verbatim to the candidate
- "Confirm & Start" has no "preparing your interview…" state during the long first LLM call
- Interview room: `Question 3/8` denominator is a ceiling not a plan (interview can end at 5/8 unexplained); no repeat-question control; no way to see time expectations; ~7s silence auto-submits a partial voice answer — too aggressive, needs a visible "still listening" affordance and a longer window
- Voice consent re-shown on every refresh even though already recorded — skip when on file
- 410 (expired link) shown with a Retry button that can never work — treat as terminal
- Completion screen: needs a receipt (topics covered, next steps, response SLA) instead of a dead-end thank-you
- Phone-cam page never warns that screen-lock kills pairing — the #1 false-flag cause

### Admin app (`admin/`)

**Onboarding & billing**
- Stepper advertises 5 steps including a dead "Verify Email" step that's silently skipped (180-line OTP screen is unreachable)
- Country/State/City are free-text inputs — use selects
- One lump validation error ("fill in all required fields") — name the fields
- Pricing: "save more" with no stated discount; no plan-comparison table; load error has no retry
- Checkout: cancel → Retry always 400s; retry shows "null plan (null)" in the Razorpay modal
- No invoice list, no billing history, no receipt download (endpoints exist); grace/expiry state invisible until a mutation fails as a toast

**Jobs & rubric**
- JobForm: 5 fields total; no loading state when editing (form flashes empty); no 404 handling; no rubric step on the create path — make rubric review part of job creation
- JobList: publish/delete swallow all errors (no try/catch); raw `confirm()` dialogs; new job shows "No rubric yet" until manual refresh (compile is async, list doesn't poll)
- RubricEditor: validation error names no row while rows are collapsed by default; no way to delete/discard a draft; Recompile button never shows a spinner; no version diff view
- Publish-boards modal renders 4 stub connectors (fake `.example` domains) as if real

**Candidate management**
- Three list surfaces with different columns/filters/sources — unify into one
- No bulk actions, no column sorting, no CSV export, no saved filters; silent 500-candidate cap makes totals disagree between screens
- CandidateDetail: 8 header controls crammed in one row — group into a primary action + overflow menu; no error state (404 = skeleton forever); Rescore hidden exactly when evidence engine is on; Erase (hard delete) behind a single `confirm()` — needs type-to-confirm
- Pipeline: 14 fixed columns ≈ 4000px scroll; no drag-and-drop; no per-job filter; no age-in-stage; every move refetches the whole company context for every connected admin
- Evidence is split across three unlinked screens (CandidateDetail ↔ ScoreExplanation ↔ InterviewReport) — cross-link them; decision loop is ~11 clicks with backtracks
- Review queue: two outcomes only (no "need more info"/reassign); one in-flight action disables every button on every card; `score_below_threshold` renders as a raw enum; no resolved-history view (API exists); no SLA/aging — oldest items fall off the 200-cap list first

**Reports**
- API failure renders identically to "No data in this period" — show an error + retry
- Only 3 fixed ranges — add a date picker; no per-job breakdown; no drill-down from any chart to candidates; no CSV

**Notifications**
- Bell/list items aren't clickable through to the candidate (meta.candidateId carried and ignored)
- Type filter missing 6 of 18 types including the most common (`candidate_stage_changed`)
- Read state is company-wide — one recruiter's "mark all read" clears everyone's badge

**Settings**
- Account & Company cards fully read-only — no password change, no company-profile editing
- 7 stacked cards, ~25 controls, one sticky Save — add per-section save, dirty indicator, unsaved-changes guard
- Missing controls: ATS engine mode, default ATS threshold, interview scheduling tunables (delay/hour/link validity)
- Audit Trail: 2xx status badges render unstyled (undefined tone)

### Emails

- Rejection and stage-update share the identical subject line — indistinguishable in an inbox
- Reminder email deliberately omits the interview link — include it
- Invitation says "keep a government-issued photo ID handy" — the portal never asks for one; it also never warns a laptop is needed
- All times timezone-less and rendered in server locale — add explicit timezone
- Missing entirely: interview-completion confirmation, results/receipt, link-expiry warning, review-status update
- "Our ATS engine" jargon in candidate-facing copy

### Cross-cutting

- No axios timeout on either frontend — hung requests spin forever
- No global search, no keyboard shortcuts, no dark mode
- Skeleton loading is consistently good; error/empty handling is inconsistent — standardize an error-with-retry pattern everywhere
- Toasts auto-dismiss at 4s — too fast for long quota/subscription errors; make error toasts persistent
- Enum/jargon leakage into user-facing copy across both apps — one label map per domain
- Accessibility foundations in the portal are good (aria-live, focus traps) — extend to form error focus management and custom dropdowns across both apps
