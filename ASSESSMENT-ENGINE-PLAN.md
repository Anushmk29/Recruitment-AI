# ASSESSMENT ENGINE PLAN — Agentic Probe-Driven Skills Assessment

> The sequenced plan for adding a full assessment/test capability (the "HireMee feature set") to this
> platform **without disturbing the existing architecture** — and with agentic generation as the USP.
> Extends [BUILD-PLAN.md](BUILD-PLAN.md); same discipline: one phase at a time, acceptance gates,
> everything behind flags. Grounded in [HIREMEE-DEMO-ANALYSIS.md](HIREMEE-DEMO-ANALYSIS.md) (what the
> incumbent actually ships) and [HIRING-AGENT-COMPARISON.md](HIRING-AGENT-COMPARISON.md) (what "agentic"
> must and must not mean here). Read the CLAUDE.md Product Thesis first.
>
> _Created 2026-07-30 from a verified read of the current codebase (Phases 0–16 built)._
>
> **Status (2026-07-30): A1–A3 built + A4 core (proctoring events, soft-lock, reminders); 283/283
> unit tests green incl. 17 new engine guardrails; both SPAs build. See STATUS.md "Assessment
> engine A1–A4 core" for the itemised record and the short remaining list (drives UI, SMS,
> evidence clips on the shell, PDF section, A5 surfacing). Not yet run live against a paid LLM —
> the A1 paid eval run is an owner action._

---

## 1. The three differentiation questions (mandatory, answered)

**1. What does everyone else do here?**
HireMee (and Mettl, SHL, TestGorilla, HackerRank Tests) ship static, human-authored question banks
delivered through a proctored MCQ engine. JD→test is a *manual SME service*: blueprint → client
sign-off → build, measured in days and billed extra. Every candidate for every client gets the same
paper ("HireMee Sales Test – Pharma L2"). Scoring is right/wrong against the bank plus fixed global
thresholds (≥6.6 = "good"). Proctoring is off-the-shelf image classification with an opt-in auto-kill.
The report is a dead end — nothing connects to an interview, nothing verifies a résumé claim.
Confirmed on the HireMee call: **no adaptivity, no AI generation, no JD→test automation.**

**2. Why is that approach weak?**
- The content loop can't scale or personalize: custom = SME time = money, so clients settle for
  generic papers → identical tests everywhere → leaked/dumped/gameable, and role-irrelevant.
- Scores are uncited and uncalibrated: "5.3 Attention to Detail" has no evidence trail, no tenant
  baseline, and is indefensible under NYC LL144 / EU AI Act Annex III.
- Auto-termination is an automated adverse action running on admitted 4–6% false positives.
- The assessment result never touches the interview or the résumé — three disconnected products.

**3. What do we do instead, and what does the buyer feel?**
The assessment is the **Probe stage of Claim → Probe → Verdict, made scalable**:
- The frozen **RoleRubric compiles the assessment blueprint in minutes** (agentic), and the recruiter
  keeps HireMee's one good UX idea — the **sign-off moment** — as an Approve & Freeze on a versioned,
  immutable paper. Zero SME queue, zero days of turnaround.
- **Items are generated per tenant per role**, each traceable to a specific rubric criterion, and
  each **validated by blind-solving before a human ever sees it** (see §3). Per-candidate sampling +
  option shuffling makes leaked papers structurally less valuable.
- **Per-candidate targeting**: which items a candidate gets is driven by *their* ClaimGraph — the
  high-weight claims we couldn't verify from the résumé get probed here, and anything the assessment
  verifies **no longer needs interview time**. The interview gets shorter and sharper. Nobody ships
  that loop.
- **The recruiter stays in command of who is tested.** Assessment runs only for candidates the
  recruiter explicitly assigns in the pipeline; a senior hire skips straight to the AI voice
  interview with one click, and the skip is a recorded human decision, never a data gap. Difficulty
  is recruiter-configurable per paper — and per candidate it follows the résumé's *own claims*
  (derived in code from the ClaimGraph, recruiter-overridable): a test is always pitched at the
  level the résumé asserts.
- **Code computes every score.** Answer keys are pre-committed at freeze time; scoring is a pure
  function; the model never emits a number. Results write back into the ClaimGraph and re-score the
  candidate through the existing verification multiplier — visible as a delta the recruiter can cite.
- Proctoring flags stay **routing signals to a human** (with evidence clips), never an auto-kill.

The buyer feels: a role-specific test in minutes instead of days, a report where every point names
its criterion and its evidence, an interview that's shorter because the test already proved things,
full control over who is tested and at what difficulty, **near-zero marginal cost per candidate**
(all AI spend happens once per role at authoring time — see §7), and an audit pack that covers the
assessment too.

---

## 2. The loop, end to end

```
 RoleRubric (frozen, versioned)                       Candidate's ClaimGraph
        │                                                      │
        ▼                                                      │
 ┌────────────────────┐  agentic: sections, difficulty mix,    │
 │ Blueprint Compiler │  item specs per criterion              │
 └────────────────────┘                                        │
        ▼                                                      │
 ┌────────────────────┐  generate item+key → N blind solvers   │
 │ Item Generator +   │  (never shown the key) → agree with    │
 │ Blind-Solve QA     │  key? keep : revise/flag for human     │
 └────────────────────┘                                        │
        ▼                                                      │
 AssessmentPaper vN ── recruiter APPROVE & FREEZE (immutable)  │
        │                                                      │
        ▼                                                      │
 ┌─────────────────────────────────────────────────────────────┐
 │ RECRUITER GATE (per candidate, in the pipeline):            │
 │   "Send assessment"  — or —  "Skip to AI interview"         │
 │ Nothing runs unassigned; skips are recorded decisions.      │
 └─────────────────────────────────────────────────────────────┘
        │  assigned                                            │
        ▼                                                      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Per-candidate assembly (pure code): difficulty TIER from    │
 │ the candidate's own claimed seniority (recruiter override   │
 │ wins); sample items; PRIORITIZE items probing THIS          │
 │ candidate's unverified high-weight claims                   │
 └─────────────────────────────────────────────────────────────┘
        ▼
 Candidate test shell (user/ app): system check → sections →
 palette/review UX → autosave/resume → proctoring (existing stack)
        ▼
 ┌────────────────────┐   pure JS: key match, per-criterion
 │ DETERMINISTIC      │   aggregation, property-tested,
 │ assessmentScorer   │   reproducibilityHash
 └────────────────────┘
        ▼
 ClaimGraph write-back: verified_in_assessment / contradicted_in_assessment
        ▼
 AtsAssessment stage `post_assessment` (existing evidenceScorer rescored)
        ▼
 Interview probes DEDUPLICATED (verified claims drop off the probe list)
        ▼
 Report + PDF: per-criterion outcomes, claim verdicts, score delta
```

---

## 3. Non-negotiable rules, applied concretely to assessments

These are the CLAUDE.md rules translated into assessment-specific engineering law:

1. **The model never scores a response.** v1 ships only code-scorable item types: MCQ (single/multi),
   numeric entry, ordering. The key is committed at freeze time; `utils/assessmentScorer.js` is a pure
   function (no I/O, no clock, no model) from (frozen paper × responses) → score. Subjective/free-text
   items are **out of v1**; when they come (§7), they go through the categorical-judgement +
   deterministic-arithmetic pattern (`satisfied|partial|absent` + citations), never an LLM number.
2. **Blind-solve or abstain (the assessment version of cite-or-abstain).** A generated item is only
   trustworthy if independent solvers — who never see the key — converge on it. N=3 solver calls per
   item; unanimous agreement with the key ⇒ eligible; any disagreement ⇒ the item is *ambiguous or
   wrong* and is auto-revised (capped) or flagged to the recruiter with the disagreement shown.
   Disagreement is a routing signal (rule 4), here applied to our *own* generated content.
3. **No generic banks, ever.** Every item belongs to one tenant, one role, one rubric criterion
   (`criterionId` is schema-required). There is no cross-tenant item pool and no "good candidate"
   prior. Cross-candidate comparison is legitimate because the *paper* is frozen per role — same
   guarantee, same mechanism as the rubric.
4. **Every adverse path keeps a human.** No auto-termination. The optional integrity escalation is a
   **soft-lock**: after N high-severity flags the test *pauses* and pings the recruiter live (socket +
   notification); only a human resumes or ends it. Default: flags are advisory, exactly as today's
   interview proctoring. A failed assessment routes through the existing bands/review machinery —
   the `review` band and auto-reject rules apply unchanged.
5. **Visible uncertainty / honest degradation.** No LLM key ⇒ no paper gets generated — the feature
   is unavailable and says so. There is **no deterministic fallback that invents test questions.**
   (Contrast: the rubric has a fallback draft because Job fields exist; test items have no honest
   deterministic source.) A paper whose items were human-flagged renders those items' status openly.
6. **Hostile input assumptions.** Candidate free-entry (numeric/short fields) is sanitized and never
   fed to any model in v1. The test shell never receives keys (server-side scoring only), item order
   comes from the server, and timing is server-authoritative — the client timer is display only.
7. **Reproducibility.** `reproducibilityHash = sha256(paperVersion + itemSetHash + responsesHash +
   scorerVersion)`; same hash ⇒ same score, assertable in CI, same as Phase 6.
8. **Assessment runs only by human assignment.** The recruiter assigns it per candidate in the
   pipeline (or explicitly opts a drive into auto mode, A4.4); skipping to the interview is one
   click; both decisions are logged with actor + time. A skipped assessment renders everywhere —
   screen, PDF, API — as "not required by recruiter", never as missing data and never as a penalty.
   And because per-candidate discretion is itself a bias surface, **assignment/skip rates by score
   band join the audit pack** — we surface the recruiter's pattern, not just the AI's.

---

## 4. Architecture fit — reuse map (why this doesn't hinder anything)

Everything below **reuses load-bearing components unchanged**. No existing model is restructured; no
existing scoring path is modified except by *additive* stages behind flags.

| Existing component | Role in the assessment engine |
|---|---|
| `RoleRubric` (frozen, versioned, `probeHint` per criterion) | Sole input to the blueprint compiler; `criterionId` links every item |
| `ClaimGraph` (`verificationStatus`, `unverifiedHighWeightClaims`) | Drives per-candidate item targeting; receives verdict write-backs (enum extended, additive) |
| `AtsAssessment` (staged, never overwritten) | Gains stage `post_assessment` alongside `post_interview` — same rescore machinery |
| `evidenceScorer` verification multiplier | Assessment verification slots in below interview verification (see A3) — arithmetic already exists |
| `llmService` (generateJSON, ensemble, cache, breaker, registry, promptVersion) | All generation + blind-solve calls; new metering kinds `assessment_blueprint`, `item_gen`, `item_solve` |
| `InterviewSession` schemas: `deviceCheck`, `speedTest`, `proctoring` (consent, evidence clips, phone cam) | Copied into `AssessmentSession` as sibling subdocuments (deliberate duplication — refactoring a live model is riskier than two schema files; extract a shared module only when both are stable) |
| `useProctoring` + `faceVision` + evidence clip pipeline (user app) | Mounted by the assessment shell as-is |
| Magic-link token pattern (`interviewPortalController` + `JWT_SECRET` + audience claims, cf. phone-cam) | Assessment links use the same pattern with a distinct `aud: "assessment"` claim |
| `pipelineService.applyTransition` + `utils/pipeline.js` | Two new opt-in stages (see A2.3); the skip path is today's exact `ats_passed → interview_scheduled` transition, so existing tenants see zero change |
| `notificationService` / `interviewInvitationService` | Invitation, reminder, and status emails; new templates only |
| `quotaService` + `UsageEvent` + plan limits | New dimension `maxAssessments`/period + item-gen spend under the existing AI budget caps |
| `interviewReportPdf` + report screens | New assessment section; same honest-fallback standard |
| Eval harness + golden set + bias probe (Phase 1) | Extended with item-generation fixtures (§A1 gates) |

**New models (3):** `AssessmentPaper`, `AssessmentSession`, and item-bank telemetry rows folded into
the paper. **New services (3):** `assessmentPaperService`, `itemGenService`, `assessmentService`
(sessions + scoring orchestration). **New user-app routes (4):** `/assessment/:token`, check, hub,
item screen. Everything is **four gates deep**: `ASSESSMENT_ENGINE_ENABLED` env + per-tenant
`CompanySettings.assessments` + per-job `Job.assessmentPolicy` (default **off**) + a per-candidate
recruiter assignment — nothing runs for anyone until a recruiter both enables the job policy and
assigns a specific candidate.

---

## 5. Data model sketch

**`AssessmentPaper`** (tenant-scoped; the frozen artifact, mirroring RoleRubric's lifecycle):

```
job, company, rubric (ref + version), version (int), status: draft|approved|archived,
sections: [{ id, title, criterionIds: [String], servedItemCount, poolItemCount,
             difficultyMix { easy, medium, hard }, timeLimitSec }],
items: [{ id, sectionId, criterionId (required), targetsProbeHint: Boolean,
          type: mcq_single|mcq_multi|numeric|ordering,
          stem, options: [{ id, text }], key,            // key NEVER serialized to candidate APIs
          difficulty, rationale,
          generation: { model, promptVersion, at,
                        blindSolve: { n, agreedWithKey, solverAnswers } },
          status: active|flagged|retired,
          exposure: { serves, correctRate }              // A5 telemetry, display-only
        }],
timing: { mode: overall|per_section, totalSec },
difficultyPolicy: { mode: fixed|claim_tiered, fixedTier },  // recruiter-set on the draft (A1.4);
                                                            // claim_tiered ⇒ tier picked per candidate IN CODE (A3.0)
negativeMarking: { enabled: false },                     // default off, like HireMee
integrityDefaults: { softLock: { enabled: false, flagThreshold } },
compiledBy { engine, model, promptVersion, at }, approvedBy { user, at }, frozenAt
```

Immutability: identical mechanism to RoleRubric — `frozenAt` set ⇒ every change rejected except
`status → archived` and the display-only `exposure` counters; query-level updates banned model-wide.
Item edits or regeneration after freeze ⇒ new paper version; in-flight sessions keep pointing at the
version they started on (same guarantee as rubric-pinned scores).

**`AssessmentSession`** (tenant-scoped; sibling of InterviewSession, not a modification of it):

```
candidate, job, company, paper (ref + version),
assignment: { assignedBy (User), at, mode: manual|auto },   // the recruiter gate — no session exists unassigned
difficultyTier: { value: easy|medium|hard,
                  source: claim_derived|recruiter_override|paper_fixed,
                  basis: String },                          // e.g. "claims assert 8y React → hard"; on every report
tokenHash (unique), validFrom, startDeadline, expiresAt,
status: scheduled|in_progress|paused|completed|expired|cancelled,
assembledItems: [{ itemId, sectionId, order, optionOrder, targetsClaimId }],  // per-candidate; seeded, reproducible
responses: [{ itemId, response, timeSpentMs, markedForReview, savedAt }],     // autosaved per answer
sectionState: [{ sectionId, status: not_started|in_progress|completed, startedAt, timeSpentMs }],
deviceCheck, speedTest, proctoring,        // same subdocument shapes as InterviewSession
result: { scoredAt, scorerVersion, reproducibilityHash,
          perItem: [{ itemId, correct }],  // key match only — computed server-side
          perCriterion: [{ criterionId, itemCount, correctCount }],
          claimVerdicts: [{ claimId, verdict: verified|contradicted|inconclusive, itemIds }] },
reminder flags, timestamps
```

Note `unique: true` is on `tokenHash` only — unlike InterviewSession, a candidate may legitimately
have both an assessment session and an interview session; they are different steps of one pipeline.

---

# PHASE A1 — Paper compiler + agentic item generation with blind-solve QA

**Size: L. The differentiated core — and deliberately shippable with zero candidate-facing surface,
so it can't break anything that exists.**

### Why now
Everything else consumes the frozen paper. Building generation first also front-loads the riskiest
question — *can generated items reach recruiter-acceptable quality?* — while the blast radius is one
admin screen.

### Build
- **A1.1 — `AssessmentPaper` model** as in §5, lifecycle cloned from `RoleRubric` (frozen guard,
  version-per-job, archive-on-supersede, AuditLog on approve).
- **A1.2 — `assessmentPaperService.compileBlueprint(job)`**: requires an **approved rubric** (no
  rubric ⇒ actionable error pointing at the rubric editor — the dependency is a product feature, not
  a limitation). Agentic step 1: criteria → sections (grouping, naming, counts, difficulty mix,
  per-section time), with `must_have` criteria guaranteed coverage and `probeHint` carried onto item
  specs. Deterministic post-processing normalizes counts/times in code.
- **A1.3 — `itemGenService`**: per item spec → generate {stem, options, key, rationale, distractor
  rationale} (registry role `reasoning`, temp 0, versioned prompt, metered `item_gen`) → **blind-solve
  gate**: N=3 independent solver calls (prompt contains stem+options only, never the key, order
  perturbation between solvers; metered `item_solve`) → unanimous-with-key ⇒ `active`; else one
  revision cycle ⇒ re-solve; still disagreeing ⇒ `flagged` with the solver split stored and shown.
  When `difficultyPolicy.mode` is `claim_tiered`, pools are generated per tier (easy/medium/hard)
  per criterion — **pool sizes are capped** (config, small by default) because tiering multiplies
  authoring volume; the cap plus the per-paper ceiling keep the one-time cost bounded.
  Per-paper generation budget cap; the whole run is resumable (items persist as they pass).
- **A1.4 — Admin `PaperEditor.jsx`** (from JobForm, beside "Scoring Rubric"): blueprint view →
  generate → item review (stem/options/key/rationale, per-item regenerate, flagged items surfaced
  with the disagreement), section/timing editing on drafts, **difficulty controls** (paper-level
  `difficultyPolicy` — fixed tier vs claim-tiered — plus per-section difficulty mix), **Approve &
  Freeze** with confirm gate. Version tabs + provenance banners, cloned from RubricEditor's grammar.
- **A1.5 — Eval fixtures**: extend the harness with a paper-generation suite — planted-defect items
  (wrong key, two defensible answers, ambiguous stem) that the blind-solve gate must catch; a
  clean-item set it must pass; CI-runnable via record/replay.

### Guardrails
- No approved rubric ⇒ no compile. No LLM ⇒ no paper, honestly labelled — **never a fabricated or
  template paper** (§3.5).
- Solver calls must never receive the key (structural: separate prompt builder, unit-pinned).
- `criterionId` schema-required on every item; an item that maps to no criterion cannot exist.
- Generation spend under the tenant's existing AI budget caps; per-paper hard ceiling.
- Frozen papers immutable (pinned by the same test pattern as `frozenViolation`).

### Acceptance gate
- [ ] Compile → generate → review → approve → freeze end-to-end in the admin UI against a real rubric.
- [ ] Blind-solve gate: 100% of planted-defect fixtures are caught (flagged or revised); clean set
      passes with ≥90% first-pass yield.
- [ ] A frozen paper rejects mutation; regeneration creates v2; v1 sessions unaffected.
- [ ] Every item carries criterionId + full generation provenance including solver results.
- [ ] `UsageEvent` rows for `assessment_blueprint` / `item_gen` / `item_solve`; budget cap enforced.
- [ ] With the LLM disabled: compile returns a labelled, actionable failure; nothing is invented.

### Rollback
`ASSESSMENT_ENGINE_ENABLED=false` hides the router + UI; nothing else references papers yet.

---

# PHASE A2 — Candidate test shell + sessions + deterministic scoring

**Size: L. The commodity-UX phase — adopt the exam grammar HireMee validated over 9 years; candidates
already know it from NTA-style tests.**

### Why now
A frozen paper is inert until a candidate can take it. This phase ships the full take-a-test path with
*uniform* item selection (personalized targeting comes in A3, so this phase has zero AI in the request
path — pure CRUD + pure scoring).

### Build
- **A2.1 — `AssessmentSession` model** (§5) + `assessmentService`: create-if-needed (idempotent, same
  guarantee as interview sessions), magic-link mint with `aud: "assessment"` (same `JWT_SECRET`
  pattern; `requireCandidateAuth` gains an audience check — additive), expiry from session.
- **A2.2 — Assembly (uniform)**: sample `servedItemCount` items per section from the paper's active
  pool + shuffle options, seeded by `sha256(sessionId + paperVersion)` — per-candidate variation,
  fully reproducible, zero AI.
- **A2.3 — The recruiter assignment gate (the trigger model)**: assessments never start themselves.
  `Job.assessmentPolicy: off | manual | auto` (default `off`; **`manual` is the standard mode** —
  `auto` exists only for high-volume drives, A4.4, as an explicit opt-in). In `manual`, an
  ATS-passed candidate surfaces in the pipeline with two recruiter actions:
  - **Send assessment** — mints the AssessmentSession + invitation email, with an optional
    per-candidate difficulty override in the same dialog. This is the only path that creates a
    session: a senior hire the recruiter doesn't want tested simply never gets one, and never
    costs one.
  - **Skip to AI interview** — today's exact `ats_passed → interview_scheduled` transition and the
    existing interview-session mint; **zero new code path**, so the skip cannot break anything.
  Both actions are recorded with actor + time (stageHistory + AuditLog). New opt-in stages in
  `utils/pipeline.js`: `assessment_scheduled`, `assessment_completed` between `ats_passed` and
  `interview_scheduled` — the skip path never enters them, so every existing tenant's transitions
  are byte-identical. Legacy stage map untouched. Per-job window config (validity,
  deadline-to-start) applies at assignment time; when the assessment completes, the interview
  session mints (A3.4 wires the ordering).
- **A2.4 — Test shell (user/ app)**: routes `/assessment/:token` (login) → system check (reuse
  PreInterviewCheck's device/bandwidth components) → instructions (per-paper custom text) →
  **section hub** (per-section status/timers, Start/Resume/Revisit) → **item screen**: question
  palette with color legend (not visited / current / answered / marked-for-review), live
  answered/unanswered/flagged counters, mark-for-review, Previous/Next/Reset, confirmation modals
  with counts on section submit and final submit, section summary screens, full-screen mode.
- **A2.5 — Autosave + resume**: every answer PATCHes immediately (server-persisted); re-login with
  the same link resumes at the exact item; server-authoritative timing (remaining time computed
  server-side on every save; expiry closes and scores what exists).
- **A2.6 — `utils/assessmentScorer.js`** (pure): key match per item type, per-criterion aggregation,
  reproducibilityHash; property tests (score bounds, order-invariance, monotonicity: an added correct
  answer never lowers a criterion, empty responses ⇒ floor not crash).
- **A2.7 — Admin status tracker**: per-job live tile — Not Started / Started / Completed / Expired
  with counts + percentages (socket events via `emitToCompany`), per-candidate row with section
  progress, **plus an "Awaiting decision" queue** (ATS-passed, unassigned candidates with the
  Send/Skip actions inline) — the gate is a queue, not a hunt. The screen HireMee recruiters live in.

### Guardrails
- **The key never leaves the server**: candidate-facing serializers are allow-listed; a test asserts
  no API response under `/assessment` contains a `key` field.
- Timer enforcement is server-side; a hacked client cannot buy time (expiry check on every write).
- Submissions after expiry are rejected; partial work is scored, labelled `completedBy: "expiry"`.
- Session status can never be mutated by the candidate API beyond the legal state machine.
- Quota: assessment start consumes the new plan dimension; in-flight sessions are never blocked
  (same seam as interviews — checked at start only, source-pinned). Invited-but-never-started
  candidates consume nothing.
- In `manual` mode no session can exist without an `assignment` row naming the recruiter — pinned
  by test; `auto` requires the explicit job-level opt-in.

### Acceptance gate
- [ ] Full candidate run: assign → link → check → sections → palette/review → submit → scored, on a
      real paper.
- [ ] Skip path: recruiter sends a candidate straight to the AI interview — no assessment artifacts
      are created, the skip is visible in stage history, and the report reads "not required by
      recruiter".
- [ ] Kill the tab mid-test → re-open link → resume at the same item with the same clock (live test).
- [ ] Grep/serializer test proves no key ever reaches a candidate payload.
- [ ] Same responses ⇒ same reproducibilityHash ⇒ identical score, 100 consecutive runs.
- [ ] Scorer property tests green; expiry-close scores partial work and labels it.
- [ ] A tenant with the flag off sees zero change anywhere (pipeline regression suite green).

### Rollback
Per-job `assessmentRequired=false` reverts a role to today's flow instantly; env flag kills the
routes; sessions in flight complete (never strand a candidate mid-test on a flag flip).

---

# PHASE A3 — Close the loop: claim targeting, verdicts, rescore, dedup

**Size: M. The phase that makes this OUR assessment rather than a better HireMee.**

### Build
- **A3.0 — Claim-derived difficulty (code, not a model call)**: the "AI sets difficulty from the
  résumé" requirement, done on-thesis. The extraction already read the résumé — the tier derives
  **deterministically** from the candidate's own claims (`normalized.years` / `level` on claims
  matching the paper's criteria): junior claims ⇒ standard tier, senior claims ⇒ hard tier. The
  framing matters: difficulty is not a courtesy, it is **claim-matched probing** — verifying
  "8 years of React" *requires* the hard React items; serving a senior claim easy questions verifies
  nothing. A recruiter override at assignment time always wins. The tier, its source, and its
  human-readable basis are recorded on the session and every report; cross-candidate views badge
  the tier so comparison stays honest. Zero LLM cost, fully reproducible, and bias-blind by
  construction (claims come from redacted text; the counterfactual probe covers the mapping).
- **A3.1 — Targeted assembly**: assembly (A2.2) upgrades — items whose `criterionId` matches one of
  the candidate's `unverifiedHighWeightClaims` criteria are prioritized into the sample (never
  exceeding the paper's structure; still seeded + reproducible; `targetsClaimId` recorded per item).
- **A3.2 — Verdict write-back**: extend `ClaimGraph.verificationStatus` enum (additive) with
  `verified_in_assessment` / `contradicted_in_assessment`. Deterministic verdict rule in code: all
  targeting items correct ⇒ verified; majority incorrect ⇒ contradicted (surfaced to human, never
  auto-reject); else inconclusive.
- **A3.3 — Rescore**: new `AtsAssessment` stage `post_assessment` via the existing evidenceScorer.
  Verification multiplier ordering (honest evidence hierarchy): self-reported < corroborated <
  **verified_in_assessment** < verified_in_interview — an MCQ is real proof but weaker than a probed
  live explanation. Contradicted zeroes the criterion, same as interview contradiction.
- **A3.4 — Probe dedup**: `probeService` skips claims already `verified_in_assessment`; contradicted
  claims *stay* probed (the interview gives the candidate the chance to explain — procedural
  fairness). Measured effect: interviews shorten. Ordering wiring: assessment completion triggers
  `assessment_completed` transition + interview session mint (the A2.3 seam, now default-on when
  `assessmentRequired`).
- **A3.5 — Reports**: "Why this score" gains the pre → post_assessment → post_interview delta chain;
  report/PDF gains an Assessment section — per-criterion outcomes + claim verdicts with the item
  count as evidence ("verified by 3/3 targeted items"), stamped with the difficulty tier and its
  basis. A skipped assessment renders as **"Assessment: skipped by recruiter decision (who, when)"**
  — the score chain is simply pre → post_interview, and nothing implies missing data. **Item
  stems/keys appear only in the admin item-review screen, never in the PDF** (leak control).

### Guardrails
- `contradicted_in_assessment` NEVER auto-rejects — routes to review with the evidence, pinned by test.
- Rescores append a new AtsAssessment; the pre doc stays bit-untouched (same law as Phase 8).
- A candidate with no ClaimGraph (legacy ATS tenant) gets uniform assembly and the paper's fixed
  tier — targeting/tiering degrade silently to A2 behavior, labelled.
- The difficulty mapping keys off claims and criteria ONLY — never any demographic or redacted
  attribute; counterfactual variants must produce the identical tier (release blocker, same law as
  every scoring path).

### Acceptance gate
- [ ] A candidate with unverified high-weight claims demonstrably receives targeting items; the
      verdict lands on the ClaimGraph; post_assessment score moves in the correct direction (live smoke).
- [ ] Contradicted verdict → ReviewItem, never a rejection (unit + smoke).
- [ ] Interview plan for an assessment-verified candidate contains no probe for the verified claim.
- [ ] Delta chain renders on Why-this-score and in the PDF; no item key in any PDF byte.
- [ ] Reproducibility holds across the pair (pre and post hashes stable across re-runs).
- [ ] Tier derivation: a senior-claims fixture gets the hard tier, a junior one the standard tier,
      a recruiter override beats both, and counterfactual variants tier identically.

### Rollback
`ASSESSMENT_CLAIM_LOOP_ENABLED=false` ⇒ A2 behavior (uniform assembly, no write-back, no rescore).

---

# PHASE A4 — Integrity + scheduling depth

**Size: M. Proctoring parity with HireMee, minus the auto-kill; plus the scheduling modes recruiters
actually asked their sales rep about.**

### Build
- **A4.1 — Proctoring in the shell**: mount `useProctoring` + consent gates + evidence clips + phone
  cam exactly as the interview does (the subdocs already exist on AssessmentSession). Map event types
  to recruiter-familiar labels (looking away / multiple people / different person / absent /
  tab-switch); honest gap note in the UI: we do not claim phone-object detection (Rekognition-style)
  — evidence clips beat a 94%-accurate object flag.
- **A4.2 — Soft-lock (the anti-auto-termination)**: per-schedule opt-in, default off. N high-severity
  flags ⇒ test pauses ("A reviewer has been notified") + live socket ping to the recruiter, who
  resumes or ends with a required reason (AuditLog). No human response within T minutes ⇒
  auto-RESUME, never auto-end — fail open, per rule 6.
- **A4.3 — Per-schedule integrity + windows config** in the scheduling UI (toggles mirror
  `CompanySettings.proctoring` grammar); deadline-to-start separate from validity window.
- **A4.4 — Shareable link + password mode** for recurring drives: one link, per-drive password,
  candidate self-registers (name/email min) ⇒ Candidate + session minted on entry; rate-limited,
  capped per drive, dedup by email. Drives run under `assessmentPolicy: auto` — the one sanctioned
  exception to per-candidate assignment, because creating the drive *is* the recruiter's bulk
  assignment decision (recorded as such, `assignment.mode: "auto"` on every session).
- **A4.5 — SMS invites** alongside email (India market): provider adapter behind
  `notificationService`-style dispatch with an `SmsLog` audit row. **Owner action: pick/contract the
  SMS provider (MSG91/Twilio) — code lands behind a flag either way.**
- **A4.6 — Reminders**: reuse the interview reminder cron pattern (24h/1h, per-session sent flags).

### Guardrails
- No consent ⇒ no capture ⇒ the test still runs (proctoring is per-schedule optional; a tenant that
  requires it states so in the invite, before the candidate clicks).
- Soft-lock can only ever pause; termination is a human action with a typed reason.
- Shareable-link mode cannot bypass quotas or dedup (an email that already applied joins its
  existing candidate).

### Acceptance gate
- [ ] Flags + evidence clips land on an assessment session and render in admin review (live browser).
- [ ] Soft-lock pauses, notifies, human-resumes; the no-response path auto-resumes (unit + live).
- [ ] Shareable link drive: N candidates enter by password, sessions minted, tracker updates live.
- [ ] SMS invite delivers against the provider sandbox (or the flag stays off, honestly labelled).

### Rollback
Each toggle per schedule; soft-lock and SMS behind separate flags; A2 behavior is the floor.

---

# PHASE A5 — Item bank hygiene + calibration + analytics

**Size: M. Later — needs accumulated response data.**

- **A5.1 — Exposure + difficulty telemetry**: per-item serves and correct-rate (display-only
  `exposure` counters — the one permitted write to a frozen paper, additive counters only).
  Surfaced to the recruiter: "this item is answered correctly by 96% — it discriminates nothing";
  "this item has served 500 times — consider regenerating". **Humans regenerate ⇒ new version;
  never auto-tuning** (the Phase 10 law applied to items).
- **A5.2 — Retirement**: recruiter retires an item ⇒ excluded from future assembly (new sessions
  only); paper version bump on structural change.
- **A5.3 — Calibration join**: assessment scores enter the existing ScoreOutcome/calibration path so
  bands earn tenant-specific meaning ("candidates in this band advanced 42% of the time here") —
  the direct answer to HireMee's global 6.6.
- **A5.4 — Analytics**: per-paper funnel (invited → started → completed → passed), per-criterion
  outcome distributions, claim-verification rates by skill, all in the Phase 12 analytics + audit
  pack (assessment provenance joins the LL144 export).
- **Gate highlights**: telemetry never changes a served paper mid-flight; calibration is
  display-only; audit pack includes paper versions + item provenance.

---

## 6. Deliberately NOT building (and why)

- **Test pins / credit billing** — subscription + `maxAssessments` quota dimension instead; pins are
  sales friction we advertise against.
- **Auto-termination** — soft-lock with a human (§A4.2). Their own 4–6% false-positive admission is
  the argument.
- **Fixed global thresholds** — bands come from the rubric; meaning comes from tenant calibration.
- **Generic off-the-shelf test library** — the compiler makes role-specific papers in minutes; a
  "library" would be the commodity we exist to beat. (A tenant can reuse its own frozen papers
  across jobs sharing a rubric — that's versioned reuse, not a generic bank.)
- **Safe Exam Browser lockdown (v1)** — install friction for tier-2/3 candidates; full-screen +
  tab discipline + evidence clips + optional phone cam cover the credible threat model. Revisit as a
  paid add-on if a customer asks with money (the Phase 14.7 pattern).
- **Psychometrics/Big-Five instruments** — a validated psychometric is a psychometrician's product;
  generating Likert inventories with an LLM and scoring them against nothing would be the exact
  uncalibrated pseudo-measurement this thesis rejects. If ever offered, it's a licensed instrument
  integration, not generation.
- **A per-candidate LLM "difficulty adapter"** — deciding difficulty with a model call per candidate
  would add per-candidate spend and non-reproducible tiering for zero gain. Tiering is deterministic
  code over the candidate's own extracted claims (A3.0), recruiter-overridable — same outcome, free,
  reproducible, auditable.
- **Auto-assessment of every applicant** — the recruiter gate exists precisely so a senior candidate
  is never funnelled through a test the recruiter doesn't want, and so cost tracks only the
  candidates worth testing. Blanket testing is the HireMee volume model; ours is targeted.
- **LLM-scored subjective items in v1** — only after the categorical-judgement pattern is proven for
  assessment answers, with the same citation discipline as the interview verdicts.
- **Coding execution runner in v1** — deterministic and on-thesis (test cases are the ultimate
  key-match) but infra-heavy (sandboxing); it's the natural A6 once A1–A4 are live.

## 7. Cost model — cheap by construction

The economics are a design property, not an optimization to do later:

- **All LLM spend is per paper version, not per candidate.** Blueprint compilation, item generation,
  and blind-solving happen once at authoring time — metered (`assessment_blueprint` / `item_gen` /
  `item_solve`), capped per paper, and bounded by the tenant's existing AI monthly budget
  (`CompanySettings.ai.monthlyBudgetCents`). One frozen paper serves every candidate for the role.
- **Zero marginal LLM cost per candidate.** Assembly is seeded sampling (code), difficulty tiering
  is claim-derived (code, A3.0), scoring is key-match (code), verdicts are deterministic rules
  (code). Serving a candidate costs storage + one email/SMS + optional proctoring clips (already
  hard-capped at ~6 × 15s per session).
- **The recruiter gate is itself the biggest cost control**: no assignment ⇒ no session, no
  proctoring, no storage, no quota consumption. Cost tracks exactly the candidates the recruiter
  decided were worth testing — a senior hire skipped to the interview costs literally nothing.
- **Tiered pools are the one authoring-cost multiplier** — bounded by per-tier pool caps (A1.3) and
  the per-paper ceiling. `fixed` mode exists for tenants who want the minimum.
- **No background spend, ever.** Regeneration and re-tiering are human actions producing a new
  version; nothing re-generates on a cron.
- Quota `maxAssessments` counts **started** sessions only — invitations that expire untouched
  consume neither quota nor money.

## 8. Sequencing + dependencies

**Order: A1 → A2 → A3 → A4 → A5.** One phase at a time, same as BUILD-PLAN; A1 has zero
candidate-facing surface; A2 is the largest UX lift; A3 is small because Phases 5–8 built the
machinery it plugs into; A4 rides the existing proctoring stack; A5 waits for data.

Depends on existing open items: none blocking. The Phase 6/7 live-LLM eval run and shadow soak are
still worth doing first for their own reasons, but the assessment track touches neither engine.

**Owner actions surfaced early:** SMS provider contract (A4.5); a paid item-generation eval run at
the end of A1 (real spend, like the Phase 6 golden-set run). The interview-ordering question is
resolved by design: the recruiter decides per candidate — assessment (when assigned) always precedes
the AI interview, which is what makes probe dedup shorten interviews; a skip goes straight to the
interview through today's unchanged transition.

**Cross-cutting requirements** (identical to BUILD-PLAN's list): flagged · metered · provenance on
every artifact · tenant-scoped + explicit company filters · audited mutations · degradable with
labels · fixtured in the same commit · bias-probed (assembly targeting must be blind to redacted
attributes — targeting keys off criteria/claims only, never demographics; pin with the
counterfactual probe) · honest rendering everywhere.
