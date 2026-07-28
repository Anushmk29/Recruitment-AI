# Platform Experience Audit — Candidate & Recruiter Deep Dive

_Date: 2026-07-27. Method: four parallel code-walks over `user/`, `admin/`, and `backend/` (every
claim below carries a file:line reference — nothing here is inferred from docs alone). This is a
no-sugar-coating assessment written to be shown externally._

---

## 1. Executive verdict

| Perspective | Rating | One-line verdict |
|---|---|---|
| **Candidate taking the AI interview** | **4 / 10** | A genuinely thoughtful interview room wrapped in dead ends: mobile users silently can't start, interrupted interviews can't be resumed, expired links lock you out permanently, and the "you'll actually know how you did" promise on the landing page is never kept — the candidate ends every interview in silence. |
| **Recruiter running hiring** | **5 / 10** | The evidence screens (Why-this-score, claim verification, rubric editor, bias audit pack) are the best-designed in this market — and almost none of a real tenant's candidates ever reach them, because the differentiated engine is unreachable from the UI and the job form ships without a single scoring field, making the default screening funnel a pass-everyone conveyor. |
| **The engine underneath** | **7.5 / 10** | The claim→probe→verdict pipeline (span-verified citations, frozen rubrics, pure deterministic scorer, QA gate, calibration guardrails) is real, rigorous, and unlike anything incumbents ship. But the AI interview evaluation itself violates the product's own Rule 1 — the LLM directly emits the 0–100 score and the hire/no-hire recommendation — and no real LLM output has ever passed through the pipeline in test. |

**The single most important finding:** the platform's differentiated core is dark-launched. The parts
users actually touch — apply form, job form, interview completion, notifications, emails — are the
weakest parts of the system, while the genuinely differentiated machinery sits behind a config flag
that no screen can flip (`scripts/_setDemoAtsLive.js` is the only switch). The product being sold and
the product being experienced are currently two different products.

---

## 2. The candidate experience

### 2.1 What is genuinely good (keep and market this)

- **Consent-first voice interview.** The mic never opens before an explicit consent screen naming
  Deepgram, and "no thanks — I'll type" is always available and evaluated identically
  (`InterviewRoom.jsx:590-616`, server-gated at `interviewPortalController.js:367-378`). No incumbent
  does consent this honestly.
- **Warn-only, in-browser proctoring.** Raw video never leaves the device; the candidate gets
  plain-language warnings, not terminations; every flag has a benign explanation attached for the
  recruiter (`utils/proctoring.js:32-45`). Evidence clips (when enabled) are event-anchored, capped,
  consent-gated — "evidence, not footage."
- **Resilient answer flow.** Draft answers persist across refresh (`InterviewRoom.jsx:62-79`), a
  failed submit silently resyncs and repairs state (`:261-273`), voice degrades to typing on every
  failure path.
- **Accessibility touches** most startups skip: `aria-live` transcript log, focus-trapped exit
  dialog, screen-reader prefixes on chat bubbles.

### 2.2 Fatal problems (each one ends a candidate's journey)

1. **Mobile candidates are hard-blocked with no warning.** The pre-check requires screen-share and
   fullscreen (`PreInterviewCheck.jsx:203-211`); `getDisplayMedia` doesn't exist on iOS/Android
   browsers, so "Confirm & Start Interview" is permanently disabled with zero explanation. Nothing in
   the invitation email, dashboard, or check screen says "use a laptop." In an India-first market
   where most candidates are mobile-first, this silently kills a large share of the funnel. Worse:
   the screen-share check is **theater** — the stream is stopped immediately (`:131`) and the screen
   is never captured during the interview, so the funnel is being killed by a requirement that does
   nothing.
2. **An interrupted interview cannot be resumed.** The exit dialog promises "You can come back and
   continue before your interview link expires" (`InterviewShell.jsx:62-65`), but the portal
   dashboard renders static text with **no button** for `in_progress` sessions
   (`InterviewDashboard.jsx:153-157`). The only way back is typing `/portal/interview` by hand.
3. **Link expiry mid-interview is a permanent, unrecoverable lockout.** The portal JWT dies exactly
   at `expiresAt` (`interviewPortalController.js:50-61`); the resend/reschedule path then throws
   forever because `aiInterview.status === "in_progress"` and **no code path anywhere resets it**
   (`interviewInvitationService.js:83,93`). Candidate locked out, admin helpless, answers stranded,
   no evaluation ever runs.
4. **Completion is a void.** After the interview: a thank-you screen, then a portal dashboard whose
   action area renders **nothing** for `completed` (`InterviewDashboard.jsx:149-163`), a raw
   `completed` badge, **no completion email** (`pipelineService.js` has no email key for
   `ai_interview_completed`), and no feedback ever. The landing page explicitly sells the opposite:
   "Every AI interview ends with a clear, evidence-based report so you actually know how you did"
   and "instead of being ghosted" (`Landing.jsx:33,54`). The report exists — it is admin-only
   (`routes/candidateRoutes.js:33-34`).
5. **Rejection silence by default.** With auto-reject off (the default), a below-threshold candidate
   gets no email, no notification, no status change — "Applied" forever (`atsService.js:201-215`) —
   while the application-received email promised "you'll be notified of the outcome"
   (`emailTemplates.js:163-169`). Review-band candidates get the same indefinite silence with no SLA;
   the review list caps at 200 sorted newest-first, so the oldest neglected humans fall off the
   bottom (`reviewQueueController.js:15-21`).

### 2.3 Major problems

6. **Apply is a blocking mega-request.** Submit waits on storage write + pdf-parse + hostility scan +
   legacy ATS + (in live mode) up to 4 sequential LLM calls + two inline emails before the 201
   (`candidateController.js:52-139`, `atsService.js:96-243`). Warm path 5–15s behind a plain spinner;
   provider-degraded path minutes; the axios client has **no timeout** (`user/src/api/client.js:11`).
   A Redis outage makes `queue.add` hang forever → infinite spinner with the Candidate already
   created and ATS never run (`config/redis.js:26`).
7. **Voice pacing punishes thinking.** ~3.2s of silence triggers utterance-end plus a 4s grace
   (`speechService.js:31`, `useVoiceInterview.js:24`): a candidate who pauses ~7 seconds to think has
   a partial answer auto-submitted. There is no per-question timer shown, no "repeat question," no
   barge-in.
8. **The schedule is fiction.** The invitation names a slot 3 days out at a timezone-less time
   (`emailTemplates.js:7-13` — no `timeZone`, no zone label), but the link works immediately and
   `startInterview` never checks `interviewAt` (`interviewPortalController.js:167-190`). The
   countdown is decorative. The reminder email deliberately omits the link
   (`emailTemplates.js:186`), sending candidates on an inbox hunt. The email also tells them to keep
   a "government-issued photo ID handy" — the portal never asks for one.
9. **Pre-check theater beyond screen-share.** The mic check stops tracks immediately — a muted mic
   passes (`PreInterviewCheck.jsx:117-125`). The speed test enforces no minimum (`:146-161`). The
   identity photo is one-shot with no preview/retake (`:318-328`).
10. **Serious data leak to the candidate's browser.** `GET /candidate-dashboard` returns raw
    `InterviewSession` documents — `tokenHash`, full proctoring counts and risk score, and the entire
    recruiter evaluation: `overallScore`, strengths/weaknesses, per-answer scores, and the
    `no_hire`-style recommendation (`candidateDashboardController.js:65-92`, no `.select()`, no
    `toJSON` transform). The apply response and dashboard also ship `ats.decision`, `resumeText`, and
    `hostility` unrendered (`candidateController.js:139`). Anyone with DevTools sees their verdict —
    and screenshots of "recommendation: no_hire" are how this ends up on social media.
11. **Duplicate applications are unguarded** — no unique index on (job, email), no server-side
    idempotency, no disabled-submit guard: double-click = two Candidates, two quota charges, two ATS
    runs, potentially two live interview links (`candidateController.js:94`,
    `models/Candidate.js:214-219`). And apply never binds the form email to the logged-in account
    (`candidateController.js:54`) — you can apply as any email and route another person's
    notifications.
12. **Marketing promises the product breaks.** "Your saved profile and resume pre-fill every
    application" — the apply form prefills nothing and cannot reuse the resume library
    (`ApplyForm.jsx:59-75`; the `/resume` library and applied resumes are two disconnected stores).
    "See Your Match Score" — no candidate-facing score exists anywhere.

### 2.4 Minor but corrosive

- 410 (expired link) is treated as retryable in the interview room — a Retry button that can never
  succeed (`InterviewRoom.jsx:256-277`).
- Any dashboard fetch error logs the candidate out ("session expired") — including 500s and network
  blips (`CandidateDashboard.jsx:102-106`).
- Billing jargon shown verbatim to candidates: "Plan limit reached: 12/10 AI interviews this billing
  period on the starter plan. Upgrade to continue." (`quotaService.js:104-110` →
  `PreInterviewCheck.jsx:253`).
- Raw enum strings (`completed`, `expired`, `interview_completed`) rendered as UI copy; "our ATS
  engine" in candidate email copy.
- Voice consent re-shown on every refresh even though it's already recorded server-side
  (`InterviewRoom.jsx:100-104`).
- The live magic link is printed in plaintext on the portal dashboard (`InterviewDashboard.jsx:130-141`).
- Forgot-password shows success even when the request failed (`ForgotPassword.jsx:14-23`).
- Dead code shipping: `/verify-email` flow unreachable (register auto-verifies,
  `authController.js:102-113`).

---

## 3. The recruiter experience

### 3.1 What is genuinely good

- **ScoreExplanation** (`pages/dashboard/ScoreExplanation.jsx`) is the best screen in the product:
  criterion-by-criterion points with quoted resume evidence, verification labels ("self-reported" vs
  "verified in interview"), knock-out gates, pre→post interview delta, calibration line with honest
  sample-size gating, reproducibility hash. This is the demo that wins deals.
- **InterviewReport's claim-verification card**: resume quote vs transcript quote side by side per
  probe, with "it never auto-rejects" framing. Nobody else ships this.
- **RubricEditor**: provenance banners (AI vs amber "Compiled without AI"), JD quality flags with
  verbatim evidence, drag-to-reclassify lanes, two-threshold design, Approve & Freeze semantics.
- **Review queue philosophy**: "candidates the engine is honestly unsure about" with plain-English
  reason chips and decisions recorded as calibration labels.
- **One-click Bias Audit Pack** (LL144-shaped JSON with rubric provenance and counterfactual
  results) — a compliance artifact no competitor can produce.
- Honest fallback labeling everywhere ("Deterministic fallback — every score below is a
  PLACEHOLDER").

### 3.2 Fatal problems

1. **The evidence engine cannot be turned on from the product.** The per-tenant switch
   (`CompanySettings.ai.atsEngine`) is not in Settings — the controller whitelist excludes it
   (`companySettingsController.js:80-87`) and `grep atsEngine admin/src` returns nothing. The only
   switch in existence is a demo Mongo script (`scripts/_setDemoAtsLive.js`). A recruiter can
   compile, review, and freeze a rubric, watch the badge turn green — and every candidate is still
   scored by the keyword engine, with no indication, because every UI disclosure keys on
   `rubricStatus`, not the engine.
2. **The job form cannot describe a job.** It exposes 5 fields (title, department, location,
   description, requirements — `JobForm.jsx:10`). None of the scoring fields (`requiredSkills`,
   `minExperienceYears`, `requiredEducation`, `atsThreshold`, `interviewInstructions`,
   `interviewMin/MaxQuestions`) exist anywhere in the admin UI. Consequence, straight from
   `atsEngine.js`: with no required skills/experience/education every component defaults to 100 —
   **the floor score on a UI-created job is 75 against a default threshold of 60. The legacy engine
   cannot fail anyone.** The shipped screening funnel does not screen; it forwards every applicant
   to an AI interview and burns plan quota doing it.
3. **Team management does not exist.** Pricing sells "recruiter seats," the quota service counts
   them, and there is no invite/add-user endpoint at all (`grep invite|team|member backend/routes` →
   nothing). Every company is permanently one user. This is a hard sales blocker for any org with
   more than one recruiter.
4. **The recruiter cannot open the resume.** Both the resume link and Export render as plain
   `<a href>` to bearer-protected endpoints — guaranteed 401 in a new tab
   (`CandidateDetail.jsx:308-315,345-352`). The primary artifact of the whole product is
   undownloadable.
5. **The AI interview evaluation is the thing the product swears it isn't.** The LLM emits
   `overallScore`, three competency scores, and `recommendation: strong_hire|hire|maybe|no_hire`
   directly (`interviewPrompts.js:179-204`), only range-clamped in code
   (`aiInterviewService.js:314-324`); a hardcoded global threshold of 60
   (`interviewReportEngine.js:10`) turns that model-emitted number into a rendered
   ADVANCE/REVIEW/CLEAR-REJECT verdict and a "Reject" recommended action. It is also not
   rubric-bound — the evaluation prompt never sees the RoleRubric criteria. This violates CLAUDE.md
   Rules 1 and 3 in the exact place buyers will scrutinize hardest, while the screening engine
   right next to it does it correctly. Undocumented anywhere as a known gap.

### 3.3 Major problems

6. **Contradictory numbers on one screen.** In live mode the headline is the evidence score but the
   "ATS Breakdown" tiles below it remain legacy keyword components (`atsService.js:120-127`) —
   Skills 100% / Experience 100% beneath "ATS 42%", no caveat.
7. **The rubric banner lies after any JD edit.** Status comes from the highest-version rubric
   (draft v2), while scoring uses the latest approved (v1) — so the UI announces "every candidate
   below is being scored by the legacy keyword matcher" while the evidence engine runs
   (`rubricService.js:221-238`).
8. **Review queue is a ghost town by construction** (engine off by default + legacy can't fail
   anyone → nothing routes there), two-outcome only, no resolved history view (endpoint exists,
   never called), one in-flight resolution disables every button on every card
   (`ReviewQueue.jsx:133,140`), and `score_below_threshold` renders as a raw enum.
9. **Onboarding/billing rough edges**: dead OTP step (the 5-step wizard silently skips step 3;
   `VerifyCompanyOtp.jsx` is 180 lines of unreachable code); cancelling Razorpay then "Retry
   Payment" always 400s (`Checkout.jsx:113-117` never calls the cancel endpoint,
   `paymentController.js:180-182`); retry renders "null plan (null)" in the payment modal; no
   invoice list or billing history (endpoints exist, never called); quota usage API built and never
   called — the recruiter discovers limits by hitting a 429 whose structured payload the UI ignores.
10. **Notifications are dead ends.** Every notification carries `meta.candidateId` and nothing
    links through — "Sarah Chen applied" is a read-only string (`NotificationBell.jsx:63-74`).
    The type filter is missing 6 of 18 types including the most common
    (`candidate_stage_changed`). Notifications are company-scoped: one recruiter's "mark all read"
    clears everyone's badge.
11. **Pipeline board**: 14 fixed columns ≈ 4000px of horizontal scroll, no drag-and-drop (a stale
    comment describes a collapse toggle that doesn't exist — `HiringPipeline.jsx:10-12`), and every
    stage move refetches the entire company context (5 requests) for every admin connected
    (`CompanyDataContext.jsx:59-65`).
12. **Rescore is hidden exactly when you'd want it** — the button renders only when
    `engine !== "evidence"` (`CandidateDetail.jsx:291`), so you cannot re-run an evidence score
    after fixing a rubric.
13. **Reports**: audit pack ignores the selected date range (`Reports.jsx:177`); API failure renders
    as "No data in this period" (`:163-165`); the "evidence engine" badge can sit over legacy
    decision counts in shadow mode (`analyticsController.js:54-77`).
14. **Silent truncation at 500 candidates** across Dashboard/CandidatesAll/Pipeline
    (`CompanyDataContext.jsx:24`), while the per-job list uses a different call — totals disagree
    between screens past 500.
15. **3 of 6 job-board connectors are permanently disabled stubs** pointing at `*.example` domains
    (`partnerDriverFactory.js:41-44`, `naukriDriver.js:11`) yet render in the publish modal.

---

## 4. The engine — differentiated core vs. rule violations

**Genuinely differentiated and real (verified in code, not docs):**
- Span verification: model emits quotes, code computes offsets, uncitable claims dropped and
  counted; stored quote re-sliced so `resumeText.slice(start,end) === quote` exactly
  (`spanVerifier.js:56-86`). Hallucination is structurally impossible in the ClaimGraph.
- Rubric-blind, bias-blinded extraction (names/pronouns/grad-years/university brands redacted
  offset-preservingly; 400+ counterfactual variants produce byte-identical model input).
- Frozen rubric immutability including a model-wide ban on query-level updates
  (`RoleRubric.js:124-128`).
- Pure deterministic scorer with the verification multiplier that makes interview verdicts move the
  score (proof beats assertion, as arithmetic — `evidenceScorer.js:24-34`), invariant checker,
  QA gate that only ever moves candidates toward human review, append-only assessments with
  reproducibility hashes.
- Probe loop: unverified high-weight claims → neutrality-enforced interview probes (accusatory
  phrasings structurally dropped) → cite-or-abstain verdicts → write-back → deterministic rescore
  as a second assessment. The full loop exists and is smoke-tested.
- Calibration that refuses to display under n=30 and is firewalled from the scorer.

**Where it breaks its own rules:**
- Interview evaluation: LLM-emitted scores/recommendation (Rule 1), not rubric-bound (Rule 3),
  hardcoded global pass threshold. Three call sites: `interviewPrompts.js:98-111, 159-166, 179-204`.
- Disagreement routing (Rule 4) is effectively inert: `LLM_ENSEMBLE_ENABLED=false` collapses
  self-consistency to n=1, `ATS_QA_GATE=monitor` computes routing but doesn't apply it, and claim
  extraction never runs N-way at all (`claimService.js:194`).
- The counterfactual probe swaps a single fixed name ("Jordan Winters", `qaGateService.js:44`) —
  name dimension only, despite the bias-audit framing.

**Never exercised live:** zero recorded LLM fixtures exist (`test/fixtures/llm/` absent — replay
mode would throw on every call); the eval harness registers only the legacy engine; both smoke
scripts stub the LLM in-process; Tier-2 vision, voice, and the PDF render have never run against
real infrastructure. The honest claim today is "rigorously built, never battle-tested."

---

## 5. Cross-cutting operational risks (these will burn real users)

1. **Email deliverability is a live landmine.** `MAIL_FROM=algorithemicedge@gmail.com` on a Brevo
   relay — `.env.example:100-104` itself documents that Brevo accepts the handshake (EmailLog says
   "sent") then drops the mail unless the sender is verified; a gmail.com sender will also fail
   DMARC. Meanwhile the three most critical emails — account verification, password reset, company
   OTP — bypass the audited dispatch path entirely, with errors swallowed
   (`authController.js:76-80,347-351`, `companyRegistrationService.js:39`). Nothing anywhere alerts
   on `EmailLog.status === "failed"`.
2. **Invitation links are built from a disposable tunnel hostname.** `CLIENT_ORIGIN_USER`'s first
   origin is a trycloudflare.com URL and `buildInterviewUrl` uses it
   (`interviewInvitationService.js:28-36`) — every link emailed right now dies when the tunnel
   restarts, unrecoverably (only the token hash is stored). `PUBLIC_BASE_URL=http://localhost:9000`
   with `NODE_ENV=production` breaks anything built from it.
3. **`.doc` resumes are accepted and silently scored as empty text** (extension allowed at
   `middleware/upload.js:7`, magic-byte check rejects it later, `atsService.js:47-53`) — a
   legitimate candidate auto-fails with no signal to anyone. Any ZIP renamed `.docx` also passes the
   4-byte check into mammoth.
4. **Storage is local disk in production** (`S3_BUCKET=` empty) — any redeploy orphans every resume,
   after which rescoring silently produces zero-text scores.
5. **The retention job is armed by default**: `retentionDays` defaults to 365 and the job runs unless
   explicitly disabled — hard PII deletion of candidates mid-pipeline, keyed on `updatedAt`, with no
   warning to anyone, and no distributed lock (N instances = N concurrent purges)
   (`retentionJob.js:57-75`, `models/CompanySettings.js:78`).
6. **No rate limit on the most expensive endpoint** — `POST /jobs/:id/apply` (disk + pdf-parse + up
   to 4 LLM calls) is unthrottled; one account can drive unbounded spend. pdf-parse also runs on the
   main thread, stalling live interview answer submissions while it chews a big PDF.
7. **An unhandled rejection from a background path exits the process in production**
   (`server.js:73-78`) — taking down every live interview with it (no supervisor configured).

---

## 6. The USP — making the interview worth giving (differentiation discipline)

Per CLAUDE.md, the three mandatory questions, answered for the interview experience:

**1. What does everyone else do?** HireVue-style one-way video interviews with black-box scoring;
LLM-wrapper "AI interviewers" that ask everyone the same eight questions from a bank; ATS screeners
that never talk to the interview at all. In every incumbent, the candidate's experience is:
surveilled, interrogated with generic questions, then ghosted. Candidate NPS for this category is
catastrophic and employers know it — "AI interview" is currently an employer-brand liability.

**2. Why is that weak?** The interview is disconnected from the resume, so it wastes both sides'
time re-litigating what the resume already established, and produces a score nobody can trace to
anything. The candidate gets nothing back, so the best candidates drop out of the funnel, and the
verdict is legally indefensible (unauditable, uncalibrated, unreproducible).

**3. What do we do instead, and what value can a buyer feel?** The Claim→Probe→Verdict loop is
already ~80% built server-side. The move is to make it *visible to both humans*:

- **A. Tell the candidate what the interview is about — before it starts.** The probes are already
  generated from their specific resume claims and neutrality-enforced in code. Show them:
  "This interview will focus on your work: your Kafka migration at X, your claim of cutting p99
  latency, your ownership of the billing service." No one in the market does this. It converts the
  AI interview from a surveillance interrogation into a structured evidence session about *your*
  work, materially improves answer quality, and is honest by construction (probes can't be gotchas —
  accusatory phrasings are structurally dropped, `probePrompts.js:117-131`).
- **B. Close the loop for the candidate.** A post-interview receipt: which of your claims were
  verified (positive framing), your transcript, what happens next and by when. The engine already
  produces every ingredient (`buildInterviewReport`); it needs a *curated candidate-safe view* —
  which also forces fixing the current leak of the raw recruiter evaluation (§2.3-10). Every
  competitor ghosts. "The only AI interview that tells you how it went" is a sellable line to
  employers because it is *their* brand candidates experience, and it's the landing page's existing
  promise.
- **C. Make the interview verdict obey Rule 1.** Replace the model-emitted overall/recommendation
  with rubric-bound per-probe and per-criterion judgments (satisfied/partial/absent — the same shape
  the evidence matcher already uses) aggregated by the existing pure scorer. Then the sales claim
  "the model never emits the score" becomes true of the whole product instead of half of it, and the
  post-interview rescore (already built) becomes the *only* interview number — one coherent,
  auditable score per candidate instead of two competing ones.
- **D. Sell the closed loop as the headline.** "Screening emits a test plan, not a verdict. The
  interview tests exactly the claims your resume couldn't prove. The final score shows which claims
  survived." That sentence is unique in the market, it is already implemented end-to-end
  (`probeService.js`, `rescoreAfterInterview`), and today it is invisible to buyers because the
  engine is dark-launched and invisible to candidates entirely.

What is *not* the USP: proctoring theatrics, more question types, a better model, video scoring.
Every one of those fails the differentiation test — they're the incumbent product with new paint.

---

## 7. Prioritized fix list

### P0 — the product does not function as sold without these

1. **Turn the product on**: `atsEngine` selector in Settings (with shadow-mode explanation), and
   scoring fields on JobForm (`requiredSkills`, `minExperienceYears`, `requiredEducation`,
   `atsThreshold`, interview question bounds, instructions). Until then every UI-created job
   auto-passes everyone.
2. **Stop the candidate-facing data leak**: curated serializers/`.select()` on
   `candidate-dashboard`, apply response, and `InterviewSession` (never ship `tokenHash`,
   evaluation, proctoring internals, `resumeText`, `hostility`).
3. **Fix the 401 resume/export links** (blob fetch like the PDF button already does).
4. **Make interviews recoverable**: a Resume-interview button for `in_progress`; an admin path that
   resets `aiInterview.status` so expired-mid-interview candidates can be re-invited; treat 410 as
   terminal in the room UI.
5. **Mobile**: drop the screen-share requirement (it's theater), make fullscreen best-effort on
   mobile, and warn "laptop recommended" in the invitation email and portal dashboard.
6. **Email deliverability**: verified sender domain, route verification/OTP/reset through the
   audited dispatch path, alert on `EmailLog.status === "failed"`, fix `PUBLIC_BASE_URL` /
   `CLIENT_ORIGIN_USER` ordering (real domain first, never a tunnel).
7. **Async ATS**: 201 immediately on apply, run screening in a queue, notify on completion. Also:
   rate-limit apply, block `.doc` at upload with a clear message, surface `ingest.status` to admins.

### P1 — trust, legal, coherence

8. Rubric-bound interview evaluation (fix the Rule-1 violation) + per-rubric interview threshold.
9. Candidate outcome communication: review-band SLA + "still in review" state, rejection emails
   that include DPO contact (already collected in Settings) and reapply guidance; interview
   completion email.
10. Duplicate-application guard (unique index + idempotent submit) and bind apply email to the
    authenticated account.
11. Timezone-correct email times with zone labels; include the link in reminder emails; kill the
    fake countdown (either real slots or honest "take it when ready before {expiry}").
12. Enable the disagreement machinery that's built but off (ensemble for boundary cases, QA gate
    enforce) once eval-run economics are measured; widen the counterfactual probe beyond one name.
13. Fix contradictory displays: ATS breakdown vs evidence headline, rubric banner after JD edits,
    Reports engine badge in shadow mode.

### P2 — competitiveness

14. Candidate-facing interview receipt + pre-interview probe preview (the USP, §6 A–B).
15. Team invites/seats (it's already sold on the pricing page).
16. Notification click-through, quota/usage meters, invoice history, pipeline board rework
    (visible-stage subset + drag), review-queue history view.
17. First live-LLM eval run over the golden set + recorded fixtures, so "measured accuracy and
    bias-probe results" becomes a demo instead of a promise.

---

## 8. Bottom line

The differentiated engine is real and better-engineered than what incumbents ship — span-verified
claims, frozen rubrics, deterministic scoring, and a closed screening→interview loop that nobody
else has. But today it is unreachable by users, undermined by its own interview evaluator, and
wrapped in a funnel with enough dead ends (mobile block, unresumable interviews, permanent
lockouts, ghosted candidates, unopenable resumes) that both personas would currently describe the
product as broken before they ever met the part worth buying. The path to sellable is not more AI —
it is wiring the existing engine to the surfaces people touch, and letting both the recruiter *and
the candidate* see the loop close.
