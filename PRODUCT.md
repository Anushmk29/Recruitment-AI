# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The product is deliberately **horizontal across four buyer classes** — confirmed by the owner, who
declined to name a single primary. No future work may optimize for one of these at the cost of the
others, and none of them is a safe default to design "for" alone:

1. **Indian IT services & product companies, volume hiring.** In-house recruiters screening hundreds of
   applicants per role. The felt pain is throughput and time-to-shortlist.
2. **Startup / mid-market talent teams.** One to five people hiring 10–40 roles a year. The felt pain is
   having no time and no repeatable structure.
3. **Staffing & recruitment agencies.** Submitting shortlists to a client company. The felt pain is
   *proving* candidate quality to a third party.
4. **Enterprise / regulated employers.** The felt pain is legal exposure and defensibility, not speed.

Three distinct in-product roles exist, with three separate identity systems (see Capabilities):

- **Recruiter / company admin** (`User{role:"admin"}`) — lives in the admin app. Creates jobs, works the
  pipeline, reads reports, makes the hiring decision. This is the paying user.
- **Candidate with an account** (`User{role:"candidate"}`) — optional registered account in the candidate
  app: applies, tracks applications, gets in-app notifications.
- **Candidate in the interview portal** — no account at all. Arrives from a magic link, is authenticated
  only against a single `InterviewSession`. This is the highest-stakes, lowest-context session in the
  product: a stranger, on their own device, being assessed.

A `superadmin` role exists in the `User` model enum but cross-company oversight is not built.

## Product Purpose

An AI-native recruitment platform that runs the hiring funnel end to end — job posted → candidate applies
→ résumé screened → AI interview → evidence-based report → hiring decision — for companies that hire on
repeat.

The stated thesis (CLAUDE.md, binding) is that this **must not be another ATS with an LLM bolted on**.
Success is not "we automated screening"; it is that a recruiter can defend every decision the system
helped them make, and a candidate is evaluated against explicit criteria rather than a vendor's opinion.

## Positioning

The owner's one-sentence positioning, verbatim from [BUILD-PLAN.md](BUILD-PLAN.md):

> Everyone else scores your résumé. **We extract what your résumé claims, prove which claims we can
> verify, hand the interview the ones we can't, and show our work for every point.**

The mechanism that a neighboring product could not truthfully copy is the **Claim → Probe → Verdict
loop**, which makes screening and interviewing *one system* instead of two disconnected products:

- The job description is compiled once into a **versioned, recruiter-approved `RoleRubric`** — explicit
  must-haves, nice-to-haves, disqualifiers, weights — frozen so every candidate for that role is scored
  identically and comparably.
- The résumé is decomposed into an evidence-bound **`ClaimGraph`**: atomic, individually cited,
  individually confidence-scored claims, not a blob of matched keywords.
- Screening output is **a test plan, not a verdict**. High-weight claims the résumé asserts but cannot
  prove become **interview probes**. The AI interview tests exactly those claims; the report closes the
  loop by marking each one verified, contradicted, or still unverified.
- Scores are **calibrated to the tenant's own outcomes**, so a number means "candidates like this
  advanced past HR 42% of the time *here*", not an abstract 78/100.

Named anti-references the product is explicitly positioned against: keyword/boolean ATS (Taleo, Workday,
iCIMS, Greenhouse, Lever), embedding-similarity vendors (Eightfold, SeekOut, hireEZ), the 2023–2025
paste-into-an-LLM-and-ask-for-a-0-to-100 wave, and HireVue-style video/facial scoring.

## Operating Context

- **Multi-tenant SaaS.** A company registers, verifies a 6-digit email OTP, pays, and is provisioned a
  workspace. Tenant isolation is enforced by a guardrail plugin + tenant context.
- **India-first.** Pricing is in ₹ via Razorpay; the go-live plan targets an India VPS stack with all data
  resident in India; DPDP compliance (retention, erasure, export, named DPO) is built into the product,
  not bolted on. Deepgram currently carries voice audio outside India and is flagged as a known,
  temporary demo-stage exception.
- **Regulatory frame is a product driver, not an afterthought.** NYC Local Law 144 (annual independent
  bias audit, published results) and the EU AI Act (employment screening is Annex III high-risk:
  explainability, human oversight, logging, record-keeping) are cited as the reason the auditable
  architecture exists — and as something to *sell*, via an exportable audit pack.
- **The real usage scenes are three, and they are not alike.** A recruiter working a queue on a desktop
  between meetings; a candidate applying on whatever device they have; a candidate alone in a proctored,
  camera-and-mic interview session that decides whether they get a job.
- **Two separately-run frontends plus an API** — see [CLAUDE.md](CLAUDE.md) for ports, env, and
  architecture. Backend :9000, admin SPA :5173, candidate SPA :5174.

## Capabilities and Constraints

**Built and verified today** (per [STATUS.md](STATUS.md), the accurate record):

- Deterministic ATS screening (keyword/skills/experience/education/projects/certifications, weighted),
  run synchronously on apply against a per-job `atsThreshold` (default 60). Pass → interview queue +
  magic-link invitation email; fail → rejection. Session creation is idempotent.
- AI interview with a **real-time voice layer**: mic → streaming STT, spoken questions via TTS, barge-in,
  live captions, and a **type-to-answer fallback**. Delivery/confidence scores are derived
  deterministically server-side from prosody.
- **Proctoring MVP**: browser signals (tab switch, blur, fullscreen exit, copy/paste, camera loss) plus
  in-browser vision (face presence, multi-face, gaze/head pose, identity match against the pre-check
  photo). Raw video never leaves the device. Server computes the risk score. Consent gate is required.
- Evidence-based interview report + downloadable PDF; admin review + decision actions.
- Real-time notifications (Socket.io + templated email, preference-gated); hiring pipeline; subscription
  billing with Razorpay; per-tenant CompanySettings self-service (AI model/budget, compliance, DPO,
  retention, branding); audit logging; Prometheus metrics.
- Compliance & AI governance wave: consent capture, human-in-the-loop ATS, bias-blinding, prompt-injection
  defense, provenance, safe fallback.

**Committed direction, not yet built.** The Claim → Probe → Verdict engine described under Positioning is
the *target*, sequenced in [BUILD-PLAN.md](BUILD-PLAN.md). Phase 0 shipped; Phase 1 (evaluation harness +
golden set) is next. Today's screening is still the deterministic keyword engine. **Design work must not
present the evidence-bound engine as already shipped.**

**Binding engineering constraints** (CLAUDE.md, non-negotiable — several have direct UI consequences):

1. **The model never emits the score; code computes it.** Any path where an LLM's number becomes a
   candidate's score is a bug.
2. **Cite or abstain.** Every extracted fact carries verbatim character spans, verified in code as literal
   substrings of the source. Uncitable facts are dropped.
3. **No generic evaluation.** Every judgement is relative to an explicit, versioned, human-approved rubric
   for *this* role at *this* company, and names the criterion and evidence that drove it.
4. **Disagreement routes to a human** rather than being averaged into false confidence.
5. **Uncertainty must be visible.** Degraded / fallback / no-API-key paths must be labelled as such
   *everywhere they surface* — screen, PDF, and API. Never render a placeholder as if it were a
   measurement.
6. **Every automated adverse action needs a human.** Auto-reject is opt-in and default-off; the
   deterministic fallback must never emit an adverse recommendation.
7. **Assume input is hostile.** Résumés are adversarial documents (prompt injection, invisible keyword
   stuffing, LLM filler). Defend explicitly and log what was detected.

**Terminology** (use these words; they are the product's own): Claim → Probe → Verdict · `RoleRubric` ·
`ClaimGraph` · probe · verdict (verified / contradicted / unverified) · ATS score and threshold ·
interview queue · interview portal · magic link · pre-check · risk score · tenant / workspace ·
audit pack.

**Explicitly undecided:** the product name (below); real analytics/reporting depth; departments as a
first-class model; external job-board publishing; super-admin oversight; recording + secondary camera.

## Brand Commitments

- **"HireFlow AI" is a placeholder, not a committed name** — confirmed by the owner. It stays in the UI as
  the **working label** so nothing breaks, but it is provisional. Future work should keep the wordmark
  swappable in one place rather than baking the name into assets, copy, or structure. Naming is an open
  decision, not settled truth.
- The repository is variously called `Recruitment-AI` and `hiringAI`; neither is a brand.
- **The contact details currently on the marketing page are placeholders** — `sales@hireflow.ai` and
  `+91 11 4000 1234` are not real and must not be presented as reachable.
- Voice in the existing marketing copy is plain, direct, and slightly pointed — "hire faster, without
  hiring worse", "not skimmed by a tired recruiter", "not just the loudest resume". That register is
  consistent with the product thesis and worth preserving, but it has not been ratified as a formal
  brand voice.

## Evidence on Hand

**Nothing real yet. The product is pre-launch** — confirmed by the owner. No customers, no logos, no
testimonials, no usage metrics, no case studies. **Future work must not invent any of them.**

Everything currently on screen that *looks* like proof is placeholder and must be treated as such:

- The hero dashboard mock in [admin/src/pages/Landing.jsx](admin/src/pages/Landing.jsx) — the candidate
  names (Priya Sharma, Aman Verma, Ritika Rao), their scores, and the stat tiles (12 open jobs, 48 in ATS
  review, 23 AI interviews) are all fabricated.
- The contact email and phone in the footer.

What *is* real and citable:

- **The subscription tiers are genuine product config**, seeded by `npm run seed:plans`: Free Trial (₹0),
  Starter (₹2,999/mo, ₹29,990/yr), Professional (₹9,999/mo, ₹99,990/yr), Enterprise (₹29,999/mo,
  ₹299,990/yr), each with real `maxJobs` / `maxAiInterviews` / `maxRecruiters` limits served from the API.
- **The working product itself** is real and demonstrable — the pipeline, the AI interview, the proctoring
  signals, and the PDF report all exist in code. Screenshots of actual product surfaces are honest
  evidence; invented outcomes are not.
- `npm run seed:demo` produces demo accounts for a live walkthrough.

## Product Principles

1. **Show the work, or don't show the number.** Auditability is the product, not a feature of it. Any
   surface that displays a score owes the user the criterion and the quoted evidence behind it. A number
   with no traceable derivation is a regression, however good it looks.
2. **Serve all four buyer classes; over-fit to none.** The volume recruiter, the two-person startup team,
   the agency proving quality to a client, and the enterprise defending a decision all use the same
   surfaces. Density, structure, and export paths have to satisfy the strictest without punishing the
   simplest.
3. **The candidate is a user, not a subject.** The highest-stakes session in the product belongs to
   someone with no account, no training, no support channel, and a job on the line. Clarity, consent,
   graceful degradation, and a way to keep going when the camera or mic fails are product requirements —
   not courtesies.
4. **Never present a placeholder as a measurement.** Fallback, degraded, and no-key states must be legible
   as such wherever they appear. This applies as much to empty states and loading skeletons as to scores.
5. **Distinctness is the mandate.** The owner's standing instruction is that "the same thing but with a
   better model" is a rejected answer. Work that makes this look like every other ATS has failed the
   brief even if it is competently executed.

## Accessibility & Inclusion

**Best effort; no formal standard is contractually required and no audit is planned** — confirmed by the
owner. WCAG 2.2 AA is not a committed floor.

Recorded product facts that bear on inclusion regardless:

- The interview supports a **type-to-answer fallback** alongside voice, and the proctoring vision tier is
  built to **degrade gracefully** when models or hardware are unavailable.
- Proctoring requires **explicit consent** before it runs.
- Bias-blinding and human-in-the-loop review are shipped; auto-reject is default-off.

Because the candidate side makes automated employment decisions and runs a camera-and-mic assessment, the
absence of a formal standard is a **known, accepted risk**, not evidence that accessibility does not
matter here. Treat it as an open decision that enterprise buyers are likely to reopen.
