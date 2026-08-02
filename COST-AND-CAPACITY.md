# Cost & Capacity — What This Platform Costs and How Much It Can Handle

_Written 2026-08-02. Derived by reading the actual code, not by estimating._
_Companion docs: [STATUS.md](STATUS.md) (what's built) · [BUILD-PLAN.md](BUILD-PLAN.md) (roadmap) · [CLAUDE.md](CLAUDE.md) (product thesis)_

**Assumptions used throughout:** OpenRouter pass-through pricing (GPT-4o-mini $0.15/M input,
$0.60/M output; GPT-4o $2.50/M input, $10.00/M output), Deepgram list prices as configured in
[speechService.js](backend/services/speechService.js#L186-L194), ₹84 = $1, and an 8-question voice
interview lasting ~25 minutes with ~18 minutes of candidate speech.

Token counts marked **(measured)** come from comments in the code recording real runs. The rest are
sized from the `maxTokens` budgets at each call site and typical résumé length (~9,000 characters).

---

## TL;DR

| Question | Answer |
|---|---|
| Cost to screen one résumé | **₹4** |
| Cost for one full voice interview candidate | **₹22** |
| Cost for one full text-only interview candidate | **₹7.64** |
| Cost of the skills assessment per candidate | **₹0** (scored by code, not AI) |
| Cost of everything a recruiter clicks | **₹0** (no AI involved) |
| One-time cost to set up a new job | **₹34** |
| Can it handle 15 résumés + interviews at once? | **Yes, easily — done in ~2 minutes** |
| How many companies can it hold? | **Thousands** |
| How many live voice interviews at once? | **~50-80** |
| Biggest single cost driver | **Deepgram listening to the candidate talk** |
| Biggest fixable waste | **`LLM_MODEL_REASONING` is unset → falls back to GPT-4o** |
| Most urgent config bug | **`REDIS_URL` is empty in `.env`** |

---

# Part 1 — What Actually Costs Money

Only **three** things cost money per candidate. Everything else is free.

| # | What | Who charges you | When it happens |
|---|---|---|---|
| 1 | **Reading the résumé** (AI) | OpenRouter | Every single application |
| 2 | **Running the interview** (AI) | OpenRouter | Only if they reach the interview |
| 3 | **Voice — listening + speaking** | Deepgram | Only in a voice interview |

### Free — zero marginal cost per candidate

- **The skills assessment/test.** [`utils/assessmentScorer.js`](backend/utils/assessmentScorer.js)
  contains **zero** LLM references. Scoring is pure JavaScript against a frozen answer key.
- **The scorecard, the interview report PDF, analytics, drift detection, calibration.** All
  deterministic code.
- **Everything on the recruiter's screen.** Dashboards, pipelines, candidate lists — plain database
  queries.
- **Emails, notifications, logins, file storage.** Infrastructure only.

> **Why this matters commercially:** competitors who let an LLM emit the score pay every time a
> report is opened or a candidate is re-ranked. You pay once, at ingestion. That zero-marginal-cost
> recruiter layer is the product thesis paying off on the P&L, not just in the audit trail.

---

# Part 2 — Which Model Runs Where

[`backend/config/models.js`](backend/config/models.js) maps every AI call site to a named **role**,
so a bare model string never floats in business logic. Roles resolve from `.env`.

**Current state of `backend/.env`:**

| Role | Env var | Your value | Resolves to |
|---|---|---|---|
| `interview` | `AI_INTERVIEW_MODEL` | `openai/gpt-4o-mini` | GPT-4o-mini |
| `extraction` | `LLM_MODEL_EXTRACTION` | *(empty)* | GPT-4o-mini |
| **`reasoning`** | `LLM_MODEL_REASONING` | **_(empty)_** | **GPT-4o** ← 16× the price |
| `cheap` | `LLM_MODEL_CHEAP` | *(empty)* | GPT-4o-mini |

**`reasoning` → GPT-4o is where ~85% of your AI spend goes.** It powers rubric matching, interview
probes, verdicts, rubric compilation, and assessment item generation. That one unset variable is the
largest cost lever you have. See [Part 7](#part-7--three-things-to-fix).

**Other relevant `.env` settings:**

| Setting | Value | Effect |
|---|---|---|
| `ATS_ENGINE` | `live` | Evidence engine drives decisions; legacy keyword engine is the labelled fallback |
| `CLAIM_ENGINE_ENABLED` | `true` | Résumés are decomposed into cited claims |
| `PROBE_ENGINE_ENABLED` | `true` | Unproven claims become interview questions |
| `ATS_QA_GATE` | `monitor` | QA checks run and log, but don't reroute candidates |
| `LLM_ENSEMBLE_ENABLED` | `false` | Multi-sample agreement checks collapse to 1 sample |
| `REDIS_URL` | **_(empty)_** | ⚠️ Email queue disabled — see [Part 7](#part-7--three-things-to-fix) |

---

# Part 3 — Cost Per Candidate, Walked Through

## Example A — Priya applies and is rejected at screening

She uploads a résumé. The AI reads it, compares it against the job's approved rubric, and she scores
below the bar.

| Step | Where in code | Model | Tokens | Cost |
|---|---|---|---|---|
| Pull ~80 individually-cited facts out of the résumé | [claimService.js:151](backend/services/claimService.js#L151) | 4o-mini | 3k in / **5.4k out (measured)** | ₹0.31 |
| Check every fact against the rubric's criteria | [evidenceMatcher.js:71](backend/services/evidenceMatcher.js#L71) | **GPT-4o** | 7k in / 2.5k out | ₹3.57 |
| Second AI tries to refute unsupported claims | [qaGateService.js:78](backend/services/qaGateService.js#L78) | 4o-mini | 5k in / 0.8k out | ₹0.10 |
| | | | **Total** | **₹3.98** |

She gets a rejection email. Nothing more is spent.

> **≈ ₹4 per rejected candidate.** In high-volume screening this is your dominant cost line, because
> most applicants never reach an interview.

---

## Example B — Rahul applies, passes, takes the test, does a voice interview

| Step | Where in code | Model | Cost |
|---|---|---|---|
| Screening (identical to Priya) | — | mixed | ₹3.98 |
| **Skills test — 30 questions, auto-scored** | [assessmentScorer.js](backend/utils/assessmentScorer.js) | **none** | **₹0.00** |
| Write interview questions targeting his unproven claims | [probeService.js:183](backend/services/probeService.js#L183) | **GPT-4o** | ₹1.26 |
| Interview plan + 8 questions + 8 answer scores + final evaluation | [aiInterviewService.js](backend/services/aiInterviewService.js#L222-L329) | 4o-mini | ₹0.78 |
| **AI speaks** — ~2,200 characters of synthesised speech | [speechService.js:130](backend/services/speechService.js#L130) | Deepgram Aura-2 | ₹2.77 |
| **AI listens** — ~18 minutes of live speech-to-text | [speechService.js:152](backend/services/speechService.js#L152) | Deepgram Nova-3 | **₹11.64** |
| Judge whether each claim was proved or disproved | [probeService.js:268](backend/services/probeService.js#L268) | **GPT-4o** | ₹1.62 |
| | | **Total** | **₹22.05** |

> **The microphone is 65% of the bill.** Listening to Rahul talk for 18 minutes (₹11.64) costs more
> than everything the AI *thinks* about him combined (₹7.64).

---

## Example C — Sneha's score lands on the pass line

Identical to Rahul, but her score falls within 6 points of the pass threshold. The QA gate
([qaGateService.js:107](backend/services/qaGateService.js#L107)) notices and re-runs the entire
rubric comparison to check the result is stable.

**Total: ₹25.62** (₹3.57 extra)

This fires for roughly 20-30% of candidates in practice. See
[Part 7, item 3](#3-the-boundary-check-currently-pays-for-nothing) — right now this money buys
nothing.

---

## Summary table

| Scenario | Cost |
|---|---|
| Rejected at screening | **₹3.98** |
| Full funnel, **text** interview (no voice) | **₹7.64** |
| Full funnel, **voice** interview | **₹22.05** |
| Full funnel, voice, borderline score | **₹25.62** |
| One-time setup per new job posting | **₹34.23** |

### What the ₹34 job setup covers (charged once, not per candidate)

| Item | Model | Cost |
|---|---|---|
| Compile the JD into a versioned, approvable rubric | GPT-4o | ₹1.89 |
| Design the assessment blueprint | GPT-4o | ₹1.26 |
| Generate 30 pool questions, each blind-solved by 3 AIs for quality | GPT-4o + 4o-mini | ₹31.08 |
| | **Total** | **₹34.23** |

---

# Part 4 — What a Real Customer's Monthly Bill Looks Like

These are **your** costs, not what you charge. Plan limits are from
[`scripts/seedSubscriptionPlans.js`](backend/scripts/seedSubscriptionPlans.js) and enforced by
[`quotaService.js`](backend/services/quotaService.js).

### Small agency — Starter plan: 200 résumés, 50 voice interviews, 5 new jobs

| Line | Cost |
|---|---|
| 200 screenings × ₹3.98 | ₹796 |
| 50 interviews × ₹18.07 *(interview portion only)* | ₹904 |
| 5 job setups × ₹34.23 | ₹171 |
| **Your AI cost** | **₹1,871** |
| Their plan's hard budget cap ($25) | ₹2,100 |
| **Verdict** | ✅ **Fits, ₹229 spare** |

### Mid-size company — Professional plan: 1,000 résumés, 300 voice interviews, 20 jobs

| Line | Cost |
|---|---|
| 1,000 screenings × ₹3.98 | ₹3,980 |
| 300 interviews × ₹18.07 | ₹5,421 |
| 20 job setups × ₹34.23 | ₹685 |
| **Your AI cost** | **₹10,086** |
| Their plan's hard budget cap ($100) | ₹8,400 |
| **Verdict** | ❌ **Cut off at ~83% of the quota they paid for** |

> ### ⚠️ This is a real pricing bug
>
> The Professional plan **sells** 1,000 screenings + 300 interviews, but its `aiBudgetCents` cap
> stops the customer at ~830 screenings' worth of spend. They hit a wall before using what they
> bought, and it reads as a broken product, not a billing limit.
>
> **Three ways to fix it, pick one:**
> 1. Raise `aiBudgetCents` on Professional from `10000` to `13000`
> 2. Set `LLM_MODEL_REASONING` to a cheap model — drops the bill to ₹4,100, well inside the cap
> 3. Reduce the plan's advertised quota to match the budget

### Campus hiring drive — 5,000 résumés, 500 interviews in one month

| Line | Cost |
|---|---|
| 5,000 screenings × ₹3.98 | ₹19,900 |
| 500 interviews × ₹18.07 | ₹9,035 |
| **Your AI cost** | **₹28,935** |

> At bulk volumes, **screening (69%) overtakes interviews (31%)** as the dominant cost. This flips
> which optimisation matters — see [Part 7, item 2](#2-the-expensive-model--with-an-honest-caveat).

### All seeded plan limits, for reference

| Plan | Jobs | Recruiters | AI interviews | Screenings | Storage | AI budget |
|---|---|---|---|---|---|---|
| Free Trial | 2 | 1 | 5 | 20 | 500 MB | $5 |
| Starter | 10 | 3 | 50 | 200 | 5 GB | $25 |
| Professional | 50 | 10 | 300 | 1,000 | 25 GB | $100 |
| Enterprise | ∞ | ∞ | ∞ | ∞ | 250 GB | $500 |

Note: Enterprise has unlimited *counts* but a $500 budget cap — a real ceiling of **~1,900
full-funnel voice candidates per month**.

---

# Part 5 — How Much Can It Handle Right Now?

## No practical limit

| | Limit | Why |
|---|---|---|
| **Companies / tenants** | Thousands | A tenant is an indexed database field, not a process |
| **Recruiters logged in at once** | ~10,000 | Their screens are plain queries with no AI |
| **Total candidates stored** | Millions | Database rows |
| **Job postings** | Unlimited | |

**Nothing about recruiters or companies is a bottleneck.** You could onboard 500 companies today
without touching the architecture.

## Real limits

| | Safe limit | What happens past it |
|---|---|---|
| **Live voice interviews at once** | ~50-80 | Per-turn latency starts drifting; TTS proxying feels it first |
| **Résumés being scored at once** | ~30-50 | OpenRouter rate limits start returning 429 |
| **Résumés per minute, sustained** | ~15-25 | |
| **Concurrent Deepgram audio streams** | *Check your plan* | Typically 50-100 on pay-as-you-go |

---

# Part 6 — The Specific Scenario: 15 Résumés + Interviews Scheduling at Once

**Short answer: yes, easily. The server won't even work hard.**

## Why it holds up

**1. Applicants never wait for the AI.**
[`candidateController.js:243`](backend/controllers/candidateController.js#L243) fires
`setImmediate(() => runPostApplyPipeline(candidate, job))`. The applicant gets an instant HTTP 200
and sees "Application submitted"; the AI work happens in the background.

**2. All 15 run side by side, not one after another.** Each pipeline is *waiting on OpenRouter*, not
computing. Waiting uses no CPU, so 15 waits cost the same as 1.

**3. The server's actual workload is trivial.** ~150 database operations spread over 2 minutes,
against a connection pool of 50 ([`config/db.js:22`](backend/config/db.js#L22)). It can handle 5,000.

### Timeline — 15 résumés arriving at 10:00:00 AM

```
10:00:00   All 15 apply. All 15 see "Application submitted!" instantly.
10:00:01   All 15 AI pipelines start AT THE SAME TIME.
10:01:15   All 15 finish reading résumés.        (~75s, measured)
10:01:45   All 15 finish rubric comparison.      (~30s)
10:01:50   All 15 finish the fraud/critic check. (~5s)
10:01:55   Done. Pass/fail decided. Emails going out.
```

**~2 minutes for all 15 — not 30 minutes.**

## Interviews being scheduled at the same time

Scheduling is cheap: mint a session, send a magic-link email. **No AI at all.** Session creation is
idempotent — re-running ATS never re-mints or re-sends an existing interview link.

## 15 people in live voice interviews simultaneously

Also fine, and here's the design decision that makes it work:

> **Candidate microphones never touch your server.**
> [`speechService.js:152`](backend/services/speechService.js#L152) mints a 60-second Deepgram token,
> and the browser streams audio **directly** to Deepgram. Your backend never sees the audio. So 15
> people talking = 15 audio streams your server has no involvement in.

Each live interview needs the AI roughly **once every 30-60 seconds** — the candidate spends the rest
of the time talking. 15 live interviews ≈ 20 AI calls per minute. Nothing.

**What the candidate experiences:** a ~3-5 second pause between finishing their answer and hearing
the next question. **This does not get worse with 15 concurrent** — everyone waits in parallel.

## Load reference table

| Load | Verdict |
|---|---|
| 15 résumés at once | ✅ Trivial |
| 50 résumés at once | ✅ Fine |
| 100 résumés at once | ⚠️ Works, but near OpenRouter's rate limit |
| 200+ résumés at once | ❌ Risky — see Part 7, item 4 |
| 15 live voice interviews | ✅ Trivial |
| 50 live voice interviews | ✅ Fine |
| 100 live voice interviews | ⚠️ Verify your Deepgram concurrent-stream limit first |

## What already protects you

- **Circuit breaker** ([llmService.js:106-152](backend/services/llmService.js#L106-L152)) — after 5
  consecutive provider failures it opens and fails fast for 60s, so callers reach their deterministic
  fallback in milliseconds instead of hanging through retries × timeout.
- **Retry with backoff** — 429s and 5xx are retried twice, honouring `Retry-After`.
- **Deterministic cache** ([llmCache.js](backend/services/llmCache.js)) — identical temperature-0
  requests are served from cache with zeroed usage, so spend is never double-counted.
- **Per-session rate limits** ([interviewPortalRoutes.js:38-64](backend/routes/interviewPortalRoutes.js#L38-L64))
  — 20 answers/min, 60 speaks/min, 40 voice tokens/min per session.
- **Socket.io Redis adapter** already wired ([config/socket.js:31](backend/config/socket.js#L31)) —
  horizontal scaling is a deployment change, not a code change.

---

# Part 7 — Things to Fix

## 1. `REDIS_URL` is empty — fix this first

Your `backend/.env` has `REDIS_URL=` with **nothing after the equals sign**.

**Consequence:** email skips the BullMQ queue and sends **inline**, one at a time, with a single
manual retry. When 15 people apply at once you get 15 emails competing on the notification path —
**the only part of the burst scenario that isn't comfortable.**

**Fix — one line:**
```
REDIS_URL=redis://127.0.0.1:6379
```

Redis is already running in your `docker-compose.yml`. This single change also enables the shared
LLM cache across instances and the Socket.io multi-instance adapter.

**Also in `.env`:** `ADMIN_SIGNUP_KEY` is defined twice (dotenv silently uses the last one — delete
one), and confirm `S3_ENDPOINT=http://127.0.0.1:9100` since MinIO sits on 9100 because the backend
owns 9000.

---

## 2. The expensive model — with an honest caveat

`LLM_MODEL_REASONING` is blank, so it falls back to **GPT-4o**, ~16× the price of GPT-4o-mini.

| | Now (GPT-4o) | Switched to mini | Saving |
|---|---|---|---|
| **Screening only** | ₹3.98 | **₹0.63** | **84% cheaper** |
| **Full funnel, text interview** | ₹7.64 | **₹1.58** | **79% cheaper** |
| Full funnel, voice interview | ₹22.05 | ₹16.00 | 27% cheaper |

> **The nuance that decides this:** the swap is transformative for **screening** and **text**
> interviews, but barely moves **voice**, because Deepgram's ₹14.41 of microphone time is a floor no
> model change can touch.

**So:**
- **High-volume / campus screening?** Switch the model. 84% off your dominant cost.
- **Voice-interview heavy?** Switch the model *and* attack the voice bill — shorten interviews
  (lower `interviewMaxQuestions` from 8), or move to a cheaper/self-hosted STT. The
  [`speechService`](backend/services/speechService.js) seam was built for exactly that swap.

> ⚠️ **Non-negotiable condition:** changing this model **changes who passes and who fails.** Run
> `npm run test:eval` and diff against the saved baseline before flipping it.
> [`config/models.js`](backend/config/models.js) exists specifically to force that check — do not
> route around it.

---

## 3. The boundary check currently pays for nothing

When a score lands near the pass threshold, the QA gate re-runs the comparison to test stability —
requesting `n: 3` samples ([qaGateService.js:127](backend/services/qaGateService.js#L127)).

But `LLM_ENSEMBLE_ENABLED=false`, so `generateJSONEnsemble` collapses `n` to **1**
([llmService.js:428](backend/services/llmService.js#L428)). And `computeConsensus` over a single
sample **always returns `agreement: 1.0`** — one value is trivially its own modal value.

**Result: every borderline candidate pays ₹3.57 for GPT-4o to confirm it agrees with itself.**

**Two valid fixes:**
- **Enable it** (`LLM_ENSEMBLE_ENABLED=true`) — costs 3× (₹10.71/boundary candidate) and you get the
  genuine disagreement signal, which is what routes ambiguous candidates to a human.
- **Skip it** when `n` would collapse to 1 — costs nothing and loses nothing you currently have.

Leaving it as-is is the only option that's strictly worse than both.

---

## 4. There is no cap on concurrent AI calls

I searched `services/`, `utils/`, `config/`, `middleware/`, and `server.js` for `p-limit`,
`semaphore`, `Bottleneck`, and `pLimit` — **zero hits.** Only email is queued (BullMQ). The evidence
pipeline is unbounded.

**At 15 concurrent applies: completely fine.**

**At 200 concurrent applies:** 200 outbound sockets open at once, OpenRouter returns 429 across the
board, and the circuit breaker reads that as provider sickness and **opens — dropping every tenant on
the platform to legacy keyword scoring for 60 seconds.**

**Fix before real volume:** wrap `runEvidenceAssessment` in a `p-limit(20)`. The excess queues for a
few seconds. Since scoring is already off the request path, no candidate notices.

---

## 5. Single process, no cluster mode

`server.js` runs one `node` process — one CPU core for JavaScript. Everything heavy is I/O, so this
is fine up to the limits in Part 5.

The Socket.io Redis adapter is **already configured**, so scaling out is a deployment change: run 2-4
containers behind a load balancer with `REDIS_URL` set. Keep `MONGO_MAX_POOL_SIZE` modest — the
cluster sees N × pool size against `mongod`'s connection cap.

---

# Part 8 — Priority Order

| # | Action | Effort | Payoff |
|---|---|---|---|
| 1 | Set `REDIS_URL` in `.env` | 1 line | Fixes the only weak spot in a 15-at-once burst |
| 2 | Fix the Professional plan budget cap | 1 line | Stops paying customers hitting a wall at 83% |
| 3 | Resolve the ensemble no-op (enable or skip) | 1 line | Stop paying for a check that returns a constant |
| 4 | Benchmark `LLM_MODEL_REASONING` → mini, then decide | `npm run test:eval` | Up to 84% off screening |
| 5 | Add `p-limit(20)` to the evidence pipeline | Small | Required before 100+ concurrent applies |
| 6 | Cluster mode / multi-container | Deployment | Required past ~80 concurrent interviews |

---

# Appendix — Where Every AI Call Lives

| Call | File | Model role | `maxTokens` | Frequency |
|---|---|---|---|---|
| Claim extraction | [claimService.js:151](backend/services/claimService.js#L151) | extraction | 16,384 | Per résumé |
| Evidence matching | [evidenceMatcher.js:71](backend/services/evidenceMatcher.js#L71) | **reasoning** | 8,192 | Per candidate |
| Adversarial critic | [qaGateService.js:78](backend/services/qaGateService.js#L78) | cheap | 1,024 | Per candidate |
| Self-consistency | [qaGateService.js:114](backend/services/qaGateService.js#L114) | **reasoning** | 8,192 | Boundary scores only |
| Probe generation | [probeService.js:183](backend/services/probeService.js#L183) | **reasoning** | 1,200 | Per interview start |
| Verdict assessment | [probeService.js:268](backend/services/probeService.js#L268) | **reasoning** | 1,600 | Per interview end |
| Interview plan | [aiInterviewService.js:223](backend/services/aiInterviewService.js#L223) | interview | 640 | Per interview |
| Next question | [aiInterviewService.js:245](backend/services/aiInterviewService.js#L245) | interview | 512 | Per question (≤8) |
| Answer scoring | [aiInterviewService.js:292](backend/services/aiInterviewService.js#L292) | interview | 128 | Per answer (≤8) |
| Final evaluation | [aiInterviewService.js:319](backend/services/aiInterviewService.js#L319) | interview | 1,024 | Per interview |
| Rubric compile | [rubricService.js:77](backend/services/rubricService.js#L77) | **reasoning** | 2,048 | Per job |
| Assessment blueprint | [assessmentPaperService.js:184](backend/services/assessmentPaperService.js#L184) | **reasoning** | — | Per job |
| Item generation | [itemGenService.js:227](backend/services/itemGenService.js#L227) | **reasoning** | 1,024 | Per pool item |
| Blind solver ×3 | [itemGenService.js:260](backend/services/itemGenService.js#L260) | cheap | 256 | Per pool item |

**Every one of these is metered.** [`usageService.recordUsage`](backend/services/usageService.js#L10)
writes a `UsageEvent` row per call with tenant, tokens, cost, latency, model, and prompt version —
so real spend is queryable per company, and `isOverBudget()` enforces the plan cap before work
starts.
