# The Live Interview — Deep Dive

_Scope: everything from "Confirm & Start" to the recruiter's report. Read alongside
[PLATFORM-EXPERIENCE-AUDIT.md](PLATFORM-EXPERIENCE-AUDIT.md) (whole platform) and
[UI-UX-IMPROVEMENT-CHECKLIST.md](UI-UX-IMPROVEMENT-CHECKLIST.md) (whole platform, short form)._

Method: read the actual code paths — `interviewPortalController`, `aiInterviewService`,
`interviewPrompts`, `probeService`, `interviewReportEngine`, `useVoiceInterview`, `useProctoring`,
`InterviewRoom`, `PreInterviewCheck`, `candidateAuth`, `speechService`, `llmService`. Every claim
below carries a file:line. No item is speculative.

---

## 0. Corrections to the earlier checklist

Four items I flagged as P0 in the whole-platform checklist are **already implemented** in the
committed code. Do not spend time on them:

- ✅ **Continue-interview button** — exists, [InterviewDashboard.jsx:116-123](user/src/pages/InterviewDashboard.jsx#L116-L123)
- ✅ **Screen-share pre-check removed** — [interviewPortalController.js:152-168](backend/controllers/interviewPortalController.js#L152-L168), [PreInterviewCheck.jsx:21-33](user/src/pages/PreInterviewCheck.jsx#L21-L33)
- ✅ **Mobile warned, not blocked** — [PreInterviewCheck.jsx:257-266](user/src/pages/PreInterviewCheck.jsx#L257-L266)
- ✅ **Expired-mid-interview recovery** — resend now allowed once the link expired, [interviewInvitationService.js:95-101](backend/services/interviewInvitationService.js#L95-L101)

Also already good and worth protecting: draft persistence across refresh
([InterviewRoom.jsx:62-79](user/src/pages/InterviewRoom.jsx#L62-L79)), the pending/retry bubble that
never overwrites server state ([InterviewRoom.jsx:241-280](user/src/pages/InterviewRoom.jsx#L241-L280)),
the resync-on-failure that detects a lost response ([InterviewRoom.jsx:262-272](user/src/pages/InterviewRoom.jsx#L262-L272)),
the exit-confirm shell, the fullscreen-lost actionable banner, and the fallback-engine disclosure
banner. That is better session-resilience engineering than most commercial AI interviewers ship.

---

## 1. What the live interview actually is today

**Flow.** `POST /start` → `beginInterview` → (1) LLM interview *plan*, (2) LLM *probe generation*
from the pre-interview assessment, (3) LLM *first question* → candidate answers (typed or spoken) →
each `POST /interview/answer` makes **one LLM call that simultaneously scores the previous answer
and writes the next question** → hard stop at `maxQuestions` (default 8) or early close once all
probes are covered and `minQuestions` (5) is reached → detached finalisation: score any unscored
answers → whole-transcript LLM evaluation → probe verdicts → ClaimGraph write-back → deterministic
post-interview rescore → notify recruiter.

**Honest one-liner:** the *plumbing* is strong (idempotent resume, provenance per turn, metered
spend, consent gates, server-owned proctoring severity, code-verified answer quotes). The
*evaluation* is a commodity LLM wrapper wearing the platform's own compliance language.

---

## 2. Differentiation discipline, applied to the live interview

**1. What does everyone else do here?**
HireVue / Talview / micro1 / Ribbon: LLM reads the JD + résumé, generates questions, transcribes the
answer, and emits an overall score plus a hire recommendation. Increasingly with facial/vocal
"engagement" scoring. The interview is a *content generator wrapped around a model's opinion*.

**2. Why is that weak?**
The score is the model's, so it is irreproducible (re-run, get a different number), unauditable (no
one can say *which criterion* the 72 came from), gameable (fluency reads as competence), and
indefensible under NYC LL144 / EU AI Act Annex III — you cannot bias-audit a number whose derivation
you cannot state. Every vendor's number means something different, so it does not transfer between
roles or companies.

**3. What do we do instead — and does the code currently do it?**
The intended answer is the Claim → Probe → Verdict loop: the interview exists to *test specific
unverified résumé claims* against a frozen, human-approved rubric, and the verdict is computed by
code from criterion-level judgements with verbatim citations.

**Today, the interview implements half of that.** Probes are real, cited, neutrality-checked,
verdict-gated on a verbatim answer quote, written back to the ClaimGraph, and they move a
deterministic post-interview score ([probeService.js](backend/services/probeService.js) — genuinely
differentiated work). But the interview's *own* competency judgement — the number the recruiter reads
as the headline — is the model's freehand `overallScore`, unbound to any rubric, thresholded against
a hardcoded 60. That is the commodity product, sitting directly next to the differentiated one.

**Everything in §3.A exists to close that gap.** It is the single highest-value work in the codebase.

---

## 3. Defect ledger

### A. Integrity of the evaluation — the ones that undermine the product's claim

**A1 · The model emits the score. (Rule 1 violation, headline severity)**
- `QUESTION_SCHEMA.answerScore` is a model-authored 0-100 for the previous answer
  ([interviewPrompts.js:102](backend/utils/interviewPrompts.js#L102)), written straight onto the turn
  ([aiInterviewService.js:438-439](backend/services/aiInterviewService.js#L438-L439)).
- `EVALUATION_SCHEMA` has the model emit `overallScore` **and** `recommendation:
  strong_hire|hire|maybe|no_hire` ([interviewPrompts.js:179-204](backend/utils/interviewPrompts.js#L179-L204)).
- `computeVerdict` is deterministic code — over a non-deterministic input
  ([interviewReportEngine.js:95-134](backend/utils/interviewReportEngine.js#L95-L134)). Wrapping a
  model's number in an `if` does not make it computed.
- **Fix:** the model returns *criterion-level judgements only* — `{criterionId, status:
  demonstrated|partial|not_demonstrated|contradicted, answerQuote, reasoning}` — and
  `evidenceScorer`-style pure code produces the number, exactly as the résumé path already does.
  Delete `overallScore` and `recommendation` from the schema entirely.

**A2 · The interview is not rubric-bound. (Rule 3 violation)**
- `aiInterviewService` never loads `RoleRubric` — grep confirms zero references. The interview
  context is JD text + résumé + ATS score ([interviewPrompts.js:34-72](backend/utils/interviewPrompts.js#L34-L72)).
- So the evaluation prompt literally says "Evaluate this candidate for the role"
  ([interviewPrompts.js:206-216](backend/utils/interviewPrompts.js#L206-L216)) — the generic
  evaluation the product thesis forbids. Two candidates for the same job can be judged against
  different implicit standards on different days.
- **Fix:** pass the frozen rubric criteria into plan, question, and judgement prompts. Every question
  declares the `criterionId` it tests; every judgement names one. Store `rubricVersion` on the
  interview so the report can say *which* standard applied.

**A3 · The per-answer score is contaminated and non-blind.**
- Answers 1..n-1 are scored inside the *question-generation* call, using the **non-blind** context —
  candidate name included ([aiInterviewService.js:354](backend/services/aiInterviewService.js#L354),
  [:420](backend/services/aiInterviewService.js#L420)) — plus the full résumé and the prior ATS score.
- The final answer is scored later by a *different*, bias-blinded, isolated prompt
  ([aiInterviewService.js:261-294](backend/services/aiInterviewService.js#L261-L294)).
- **So answers within a single interview are not scored under comparable conditions**, and most of
  them are scored while the model can see the candidate's name. The "bias-blinded evaluation" claim
  covers only the summary call.
- **Fix:** score every answer through one blinded, isolated judgement call. Never in the same call
  that writes the next question.

**A4 · Anchoring: the interviewer is shown the ATS score before it asks anything.**
- `ATS SCORE: 78 (missing: Kubernetes, …)` is injected into the interviewer's context
  ([interviewPrompts.js:65](backend/utils/interviewPrompts.js#L65)).
- The interview is therefore not independent evidence — it is a model told the answer before the
  exam. A low-ATS candidate gets a harder read; a high one gets the benefit of the doubt. This is
  precisely the correlated-error pattern a bias audit is designed to catch.
- **Fix:** remove the ATS score and the missing-skills list from the interview context. The probes
  already carry everything the interview legitimately needs from screening.

**A5 · Probe coverage is self-reported by the model.**
- `markProbeAsked` validates only that the returned `probeId` is a *pending* id — never that the
  question actually asked it ([aiInterviewService.js:58-65](backend/services/aiInterviewService.js#L58-L65)).
- Two failure modes: (a) the model asks the probe but returns `probeId:""` → the probe stays
  `pending` forever → `closingAllowed` never true → every interview runs to the hard ceiling; (b) the
  model returns a `probeId` for an unrelated question → the probe is marked covered, and the verdict
  is later assessed against **whatever answer happened to follow**
  ([probeService.js:220-226](backend/services/probeService.js#L220-L226)) — a verdict on the wrong
  answer, carrying a code-verified quote from the wrong answer.
- **Fix:** don't let the model choose. When a probe is due, *code* injects the probe's pre-generated
  question verbatim as the next turn and marks it asked. The model gets follow-ups, not coverage
  authority.

**A6 · Mid-interview degradation is invisible.**
- `ai.engine` is set once at `beginInterview` ([aiInterviewService.js:359](backend/services/aiInterviewService.js#L359))
  and never updated. If the LLM fails on question 4, `nextQuestion` silently falls back to the
  generic pool ([aiInterviewService.js:251-254](backend/services/aiInterviewService.js#L251-L254),
  [:123-132](backend/services/aiInterviewService.js#L123-L132)) while the candidate's UI still shows
  a full-AI interview and the recruiter's header still says `engine: ai`.
- Per-turn `engine` *is* stored on each turn — the surfaces just never read it. Rule 5 says
  uncertainty must be visible **everywhere it surfaces**.
- **Fix:** derive `engine` as `mixed` when turns disagree; show the fallback banner the moment it
  happens; mark fallback turns in the recruiter transcript.

**A7 · In fallback mode, "score" means word count.**
- `fallbackAnswerScore = min(90, 20 + words×2)` ([aiInterviewService.js:138-142](backend/services/aiInterviewService.js#L138-L142)),
  averaged into `overallScore` ([:170-197](backend/services/aiInterviewService.js#L170-L197)).
- `computeVerdict` correctly routes to REVIEW because `engineRan` is false
  ([candidateController.js:454](backend/controllers/candidateController.js#L454)) — good. But the
  *number itself* is still rendered next to the word "score" in the report. A 30-word non-answer
  scores 80.
- **Fix:** label it `completenessIndex` everywhere, never `score`, and never on the same axis as an
  evaluated score.

**A8 · Recruiter interview instructions are ignored by the interviewer.**
- `job.interviewInstructions` reaches the candidate's dashboard
  ([interviewPortalController.js:36](backend/controllers/interviewPortalController.js#L36)) but is
  never passed to any prompt. A recruiter writing "probe on-call experience and payment-domain
  specifics" gets a generic interview and no indication it was ignored.
- **Fix:** include it in the plan + question prompts, fenced as tenant-authored (not candidate)
  input. One-line change, immediately visible value.

---

### B. Session survival — where a real candidate loses a real interview

**B1 · An in-flight interview is killed the second the link expires. (worst remaining candidate defect)**
- `loadSession` returns **410 on every request** past `expiresAt`, with no exemption for
  `status: "in_progress"` ([candidateAuth.js:17-24](backend/middleware/candidateAuth.js#L17-L24)).
  The portal JWT expires at the same instant ([interviewPortalController.js:51](backend/controllers/interviewPortalController.js#L51)).
- Start the interview 10 minutes before expiry: at question 4 the answer POST 410s. The room only
  special-cases 401 ([InterviewRoom.jsx:256-259](user/src/pages/InterviewRoom.jsx#L256-L259)), so a
  410 falls into "Couldn't send that — check your connection and try again" with a **Retry button
  that can never succeed**. The typed answer is gone (the draft was cleared on submit,
  [:249](user/src/pages/InterviewRoom.jsx#L249)).
- **Fix:** once `status === "in_progress"`, extend the effective deadline to
  `max(expiresAt, startedAt + INTERVIEW_MAX_DURATION)` and mint the JWT against that. Treat 410 as
  terminal in the room, with the real message and a "request a new link" action.

**B2 · No idle/abandonment handling.**
- A session left open sits `in_progress` until the link expires, then becomes B1's lockout. There is
  no "are you still there", no auto-save-and-park, no partial finalisation.
- **Fix:** idle prompt at N minutes; park the session cleanly after M; make a parked session
  resumable, and finalise partials as an explicitly-labelled incomplete interview.

**B3 · No frontend HTTP timeout, anywhere.**
- `axios.create({ baseURL })` with no `timeout` ([user/src/api/client.js:11](user/src/api/client.js#L11)).
- Worst case on `POST /start`: 3 sequential LLM calls (plan → probes → first question), each
  30s timeout × up to 3 attempts ([llmService.js:37](backend/services/llmService.js#L37),
  [:43](backend/services/llmService.js#L43)) ≈ **4½ minutes of a spinning button** with no copy, no
  progress, no cancel. Typical case is still 10-30s of unexplained wait.
- **Fix:** 20s timeout on ordinary calls, explicit longer budget on `/start` with real progress copy
  ("Preparing your interview — building questions from your résumé…"); precompute probes at
  screening time so `/start` is one call, not three.

**B4 · A failed `/start` reports the wrong thing.**
- `handleConfirm` fires checks → consent → start sequentially; any failure renders "Could not
  complete pre-interview checks" ([PreInterviewCheck.jsx:241-243](user/src/pages/PreInterviewCheck.jsx#L241-L243))
  even when the checks succeeded and only the interview kick-off failed. Quota 429s surface here as
  raw billing jargon.
- **Fix:** per-step error copy; retry the failed step only.

---

### C. Voice pipeline

**C1 · Socket death silently truncates the answer.**
- There is **no `ws.onclose` handler and no reconnect** ([useVoiceInterview.js](user/src/portal/useVoiceInterview.js)).
  On a dropped connection the recorder keeps running, `ws.send` is skipped on a non-OPEN socket
  ([:272](user/src/portal/useVoiceInterview.js#L272)), and `phase` stays `"listening"` — the pulsing
  green "Listening — speak your answer" indicator keeps running over a dead pipe.
- The candidate speaks for another 90 seconds, taps Done, and **the truncated transcript is submitted
  and scored as their complete answer.** They will never know.
- **Fix:** `onclose` → set an explicit `disconnected` phase, stop the recorder, attempt one silent
  reconnect with a fresh token, and if that fails tell them plainly and offer to redo the answer or
  type it. Never submit a transcript from a session that lost its socket without saying so.

**C2 · Turn-end is still too eager for a thinking candidate.**
- 3.2s Deepgram `utterance_end_ms` ([speechService.js:31](backend/services/speechService.js#L31)) +
  4s client grace ([useVoiceInterview.js:24](user/src/portal/useVoiceInterview.js#L24)) ≈ 7.2s total.
  That is better than the 2s default, but a candidate mid-way through recalling an architecture
  decision routinely pauses longer — and the penalty is a submitted half-answer.
- The countdown is also invisible: `endingSoon` renders text, not a timer. No way to say "hold on".
- **Fix:** visible countdown ring during the grace window, a "I'm still thinking" button that resets
  it, and per-question tuning (behavioural questions get a longer window than factual ones).

**C3 · No barge-in, no repeat.**
- The mic opens only after TTS finishes ([InterviewRoom.jsx:294-304](user/src/pages/InterviewRoom.jsx#L294-L304),
  documented at [useVoiceInterview.js:167-172](user/src/portal/useVoiceInterview.js#L167-L172)). The
  candidate cannot interrupt, and there is **no "say that again" control** — if they missed the
  question, their only recourse is to answer badly or switch to typing.
- **Fix:** a Repeat button (re-plays cached audio, zero extra TTS spend) and the question text always
  visible in the transcript, which it already is — surface it as a persistent "current question"
  card rather than a scrolled-away bubble.

**C4 · Voice consent re-prompts on every reload.**
- `started` is component state ([InterviewRoom.jsx:103](user/src/pages/InterviewRoom.jsx#L103)); the
  server already holds `voiceConsent.given` and `/interview` never returns it.
- A candidate who refreshes at question 5 is asked to consent to voice capture again — reads as a
  bug, invites a decline.
- **Fix:** return `voiceConsent` in `publicState`, skip the gate when it's on file.

**C5 · Delivery/prosody is measured but its meaning is undefined to everyone.**
- WPM, filler rate, pause ratio, energy variance → `scoreDelivery` → `evaluation.delivery` /
  `.confidence` ([aiInterviewService.js:491-497](backend/services/aiInterviewService.js#L491-L497)).
- Nothing tells the candidate this is measured; nothing tells the recruiter what a 64 means; and it
  is a **live legal exposure** — vocal-delivery scoring is exactly the ADA/accent-discrimination
  surface HireVue was forced to retreat from. A non-native speaker or someone with a stammer is
  measured on an axis the rubric never approved.
- **Fix:** either drop it from any scored surface and keep it as a labelled non-scored observation,
  or make it an explicit, opt-in, rubric-declared criterion ("Communication — clarity of spoken
  explanation") with a documented adverse-impact test. Do not leave it as an unowned number.

**C6 · No mic level meter at any point.**
- Pre-check verifies *permission*, not *audio* ([PreInterviewCheck.jsx:117-125](user/src/pages/PreInterviewCheck.jsx#L117-L125)).
  A muted headset, a wrong default device, or a dead mic passes every check and dies at question 1.
- **Fix:** a live level meter plus a 3-second record-and-play-back loop in pre-check. This is the
  single cheapest fix in this document and it prevents the most common total-failure mode.

---

### D. In the room — candidate experience

- **D1 · The denominator lies.** `Question 3 / 8` ([InterviewRoom.jsx:531-533](user/src/pages/InterviewRoom.jsx#L531-L533))
  is a ceiling, not a plan — early closing at 5 is legitimate and unexplained. Show "5-8 questions,
  about 15 minutes" and a progress bar, not a fraction.
- **D2 · No elapsed time and no expectation of length.** Nothing on screen says how long this will
  take. Candidates plan their day around this.
- **D3 · Mixed incentives.** The room says "no time pressure — take a moment to think"
  ([:528](user/src/pages/InterviewRoom.jsx#L528)) while the report flags sessions under 60s/question
  as abnormally short ([interviewReportEngine.js:40-47](backend/utils/interviewReportEngine.js#L40-L47)).
  Pick one and say it out loud.
- **D4 · The candidate never learns why these questions.** Probes exist, are cited to their own
  résumé, and are the entire reason this interview is different — and `publicState` deliberately
  hides them ([aiInterviewService.js:332-345](backend/services/aiInterviewService.js#L332-L345)).
  This is the biggest missed USP in the product (see §4).
- **D5 · The current question scrolls away.** In a 52vh log, by answer 3 the question is off-screen
  while the candidate is typing. Pin it.
- **D6 · No way to flag a bad question.** If the model asks something incoherent or based on a
  misread résumé line, the candidate's only options are answer it or lose points. One "this question
  doesn't apply to me" control would be *both* a fairness feature and the best evaluation-quality
  telemetry the platform could collect.
- **D7 · The 20s watchdog message is a dead end.** "Try switching to typing, or reload the page"
  ([:312-318](user/src/pages/InterviewRoom.jsx#L312-L318)) — give it the actual buttons.
- **D8 · Completion is a dead end.** "Thank you, the team will be in touch" with no summary, no
  timeline, no receipt. See §4.

---

### E. Pre-check

- **E1 · Speed test measures and ignores.** 2 MB single sample, no minimum enforced, result stored
  and never used ([PreInterviewCheck.jsx:136-151](user/src/pages/PreInterviewCheck.jsx#L136-L151),
  [interviewPortalController.js:118-121](backend/controllers/interviewPortalController.js#L118-L121)).
  A 0.4 Mbps connection passes, then the voice interview fails. Warn below a real threshold and
  recommend the typed path.
- **E2 · Identity photo is one-shot with no preview or retake** ([:153-191](user/src/pages/PreInterviewCheck.jsx#L153-L191)).
  If no face is detected, `descriptor` is undefined, identity matching is silently disabled for the
  whole session, and nobody is told — later the report shows `identityMatch: unknown` with no
  explanation. Add preview + retake + a "no face detected, try again" check.
- **E3 · Consent is not freely given.** The UI only ever posts `given: true`
  ([:219-231](user/src/pages/PreInterviewCheck.jsx#L219-L231)) and the Start button is disabled
  without the tick ([:195-201](user/src/pages/PreInterviewCheck.jsx#L195-L201)) — while the backend
  fully supports a recorded decline ([interviewPortalController.js:270-293](backend/controllers/interviewPortalController.js#L270-L293)).
  Either offer a genuine "decline monitoring / take an unmonitored interview" path, or state plainly
  that monitoring is a condition of this assessment. The current shape is the worst of both.
- **E4 · No briefing before the leap.** Nothing says how many questions, how long, that voice is
  optional and unpenalised, that answers save as you go, or what happens after. All of it is known
  server-side.
- **E5 · No "preparing your interview" state** on Confirm & Start (see B3).
- **E6 · Phone-cam pairing never warns about screen lock** — the phone sleeps, the heartbeat goes
  stale, `phone_cam_lost` is raised against the candidate
  ([interviewPortalController.js:334-345](backend/controllers/interviewPortalController.js#L334-L345)).
  Say "keep your phone unlocked and plugged in" on the QR card.

---

### F. Recruiter side / defensibility

- **F1 · Two unreconciled verdicts.** The interview verdict
  ([interviewReportEngine.js:95-134](backend/utils/interviewReportEngine.js#L95-L134)) and the
  post-interview evidence rescore ([probeService.js:328-406](backend/services/probeService.js#L328-L406))
  are computed independently and never compared. A recruiter can see interview ADVANCE next to a
  post-interview score that dropped because two claims were contradicted. Reconcile into one
  decision object, or state explicitly that they measure different things and rank them.
- **F2 · `INTERVIEW_PASS_THRESHOLD = 60` is hardcoded** ([interviewReportEngine.js:10](backend/utils/interviewReportEngine.js#L10)).
  Not per-role, not per-tenant, not versioned, not visible in Settings. Every role in every company
  passes at the same number.
- **F3 · Interview length is per-job but has no UI.** `interviewMinQuestions` /
  `interviewMaxQuestions` are read ([aiInterviewService.js:363-364](backend/services/aiInterviewService.js#L363-L364))
  and absent from JobForm — so every interview is 5-8 questions forever.
- **F4 · `recommendation: no_hire` is on the wire.** Model-authored, stored, and (per the platform
  audit) reachable from candidate-facing payloads. Even for recruiters, an unexplained model
  recommendation is the exact artefact LL144 asks you to justify. Remove the field (A1) rather than
  hide it.
- **F5 · No calibration.** Nothing anywhere converts a 72 into "candidates scoring like this
  advanced past your HR screen 43% of the time." The BUILD-PLAN's calibration promise is unbuilt, and
  it is the difference between a number and a decision aid.

---

## 4. What "flawless" looks like — the target spec

**The turn contract.** Each turn is `{criterionId, probeId?, questionText, expectedEvidence}`. Probe
turns are injected verbatim by code, not chosen by the model (A5). Follow-ups are the model's job;
coverage is code's job.

**The scoring contract.** One blinded judgement call per answer returning *only*
`{criterionId, status, answerQuote, reasoning}`, with the quote verified as a literal substring — the
rule `sanitiseVerdicts` already enforces for probes ([probeService.js:100-130](backend/services/probeService.js#L100-L130)).
A pure scorer aggregates criterion statuses × rubric weights into the interview score. No model
number ever survives to a surface. Re-running the scorer on stored judgements must reproduce the
number exactly — that reproducibility is the sellable artefact.

**One reconciled verdict.** Résumé evidence + interview criterion evidence + claim verdicts →
one deterministic decision with a stated reason chain: *"3 of 4 must-haves demonstrated in interview;
1 résumé claim contradicted (quote ↔ quote); recommend human review."*

**Degradation ladder, visible at every step.** full AI → fallback questions (banner, per-turn marks)
→ no judgement (report says "not measured") → never a fabricated number. Already the standard the
fallback engine sets; extend it to mid-interview transitions (A6).

**Recovery model.** In-progress sessions outlive their link (B1). Idle sessions park and resume (B2).
Socket death is announced and the answer is redone, never silently truncated (C1). Every path a
candidate can hit has an action, not just a message.

**Candidate transparency — the USP, and it is nearly free to build.**

- *Before:* "This interview will focus on four things your résumé claims — Kubernetes at scale, the
  payments migration, the team-lead role, and the ML pipeline. About 6-8 questions, roughly 15
  minutes. Voice is optional and typed answers are evaluated identically." Every word of this already
  exists server-side as `ai.probes` and `ai.plan`.
- *After:* a receipt — what was covered, which claims read as supported by their own answers, what
  happens next, and by when. Not the score; the *shape* of the assessment.

Nobody in this market tells a candidate what the interview is testing before it starts, or what it
concluded after. It costs one field in `publicState` and one screen — and it converts the most
resented artefact in hiring into the one candidates recommend to each other. That is the thing to
put on the pitch slide.

---

## 5. Sequenced plan

**P0 — before this is shown as a working product (≈1 week)**
1. B1 in-progress grace + terminal 410 handling in the room.
2. C1 socket-close detection, reconnect, and never-silently-truncate.
3. C6 mic level meter + playback in pre-check.
4. B3 axios timeouts + real `/start` progress copy; precompute probes at screening.
5. A6 mid-interview degradation visible; A7 rename fallback "score" to completeness index.
6. C4 skip voice consent when already recorded; E2 identity photo preview/retake.

**P1 — the differentiation, and the legal position (≈2-3 weeks)**
7. **A1 + A2 + A3**: rubric-bound criterion judgements, blinded and isolated; pure code computes the
   interview score. Delete `overallScore` / `recommendation` from the schema. *This is the work that
   makes the pitch true.*
8. A5 code-injected probe questions (coverage is no longer model-reported).
9. A4 remove the ATS score from interview context; A8 pass recruiter instructions in.
10. F1 one reconciled verdict; F2 threshold per rubric/tenant and surfaced in Settings.
11. C5 decide the delivery/prosody question deliberately and document it.

**P2 — the sellable surface (≈1-2 weeks)**
12. D4 pre-interview probe preview; D8 post-interview receipt.
13. D1/D2/D5 progress model, elapsed time, pinned question; D6 flag-a-question control.
14. E3/E4 honest consent + real briefing; C2 visible grace countdown + "still thinking".
15. F3 interview length controls on JobForm; F5 first calibration pass against real outcomes.

---

## 6. The three sentences for the pitch

1. *"Every other AI interviewer asks a model for a number. We ask the model what the candidate
   demonstrated, with a verbatim quote — and our code computes the number, the same way, every
   time."*
2. *"The interview isn't generic. It's generated from the specific claims on this candidate's résumé
   that screening couldn't verify — and the report shows you, quote against quote, which ones held
   up."*
3. *"We tell the candidate what we're testing before we test it, and what we concluded after. That is
   why our completion rates and our defensibility both look different from theirs."*

Sentences 2 and 3 are already ~70% built. Sentence 1 is not — and it is the load-bearing one.
