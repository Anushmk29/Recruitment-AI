# AI Interviewer — what it does, where the questions come from, and how it decides

> Written 2026-08-06, immediately after the Deepgram Voice Agent pipeline was removed. This is the
> plain-language answer to four questions asked in sequence: *what can the interviewer do now,
> where do its questions actually come from, who can change them, and how does it decide what to
> ask next inside a single interview.*
>
> Companions: [VOICE-PIPELINE-GUIDE.md](VOICE-PIPELINE-GUIDE.md) (operating + switching the
> pipelines), [AI-INTERVIEW-CONVERSATION-EXAMPLES.md](AI-INTERVIEW-CONVERSATION-EXAMPLES.md)
> (three worked persona dialogues), [STATUS.md](STATUS.md) §E (what is verified),
> [CLAUDE.md](CLAUDE.md) (the product thesis these rules come from).

---

## 1. Where the platform stands after the removal

There are now exactly **two** voice pipelines, not three:

| | `turn_based` | `livekit` |
|---|---|---|
| Candidate experience | Ask → listen → next question | Continuous conversation |
| Barge-in / interrupt | Limited (echo-gated) | Yes (semantic turn detection) |
| Transport | WebSocket audio | WebRTC (auto-reconnect, mobile-resilient) |
| Keys in the browser | No | No — join-token only |
| Est. cost / 20-min interview | ~$0.20 | ~$0.40–1.00 (validate at LK-5) |
| No-LLM fallback | Yes (deterministic engine) | No — refuses up front |
| Role | The permanent floor | The live conversation |

The middle pipeline (`realtime`, the Deepgram Voice Agent transport) was deleted on 2026-08-06.
It was strictly dominated by LiveKit: ~$1.50 per 20-minute interview, WebSocket instead of WebRTC,
and it relayed the OpenRouter key toward the browser inside a Settings blob where LiveKit ships a
join-token only.

**What got better by removing it**

1. **One realtime code path instead of two.** Engine changes previously had to be reasoned about
   across two transports sharing endpoints behind an "either pipeline is on" gate — the exact
   construct that produced a live bug during LK-2.
2. **The key-custody hole is gone entirely.** No configuration can put a model key in a browser
   any more; that code does not exist.
3. **A simpler fallback ladder:** `livekit → turn_based`. Two tiers, one 10-second watchdog, fewer
   states in [InterviewRoom.jsx](user/src/pages/InterviewRoom.jsx) — and fewer ways for the "two
   open microphones" class of bug to return.
4. **Cheaper worst case.** No configuration can land a tenant on the $1.50 path.
5. **Nothing of value was lost.** `sessionBrief`, the three-function dispatch,
   `verifyQuestionsAsked`, the guardrail and the evidence chain all survive in
   [voiceAgentService.js](backend/services/voiceAgentService.js), because the LiveKit worker runs
   *through* that file. Legacy `voiceMode: "realtime"` values land safely on turn-based, and the
   worker's engine endpoints kept their paths.

**Turn-based is never removed.** It is the automatic fallback, the only pipeline with a
deterministic no-LLM path, and the cheapest option. Deleting it would turn an infrastructure
outage into an adverse candidate outcome, which violates the platform's own rules.

---

## 2. What the AI interviewer can do

From the candidate's seat it is one continuous, phone-call-style conversation with a named persona
(e.g. Ava):

- **Talks and listens naturally.** No push-to-talk. Semantic turn detection waits through thinking
  pauses instead of cutting in on a breath — and the candidate can **interrupt mid-sentence** and
  it stops and listens.
- **Handles the human moments by understanding, not phrase lists.** "Could you say that again?",
  "what do you mean?", "how many are left?", "I'm a bit nervous" — all handled conversationally.
  The turn-based client matched fixed trigger phrases; anything worded unusually fell through into
  the transcript.
- **Respects "I don't know" and "I want to stop".** A decline is acknowledged warmly and recorded
  as *not answered* — never a zero, never pressed. A stop request gets one confirmation, then a
  warm goodbye. Withdrawal is honoured without negotiation and is never adverse.
- **Asks only what the engine authored, word for word.** Its entire power is three function calls:
  `get_next_question`, `submit_answer`, `end_interview`. Delivery fidelity is verified afterwards —
  the last live e2e returned `questionsNotAskedVerbatim: 0`.
- **Never evaluates out loud and never scores anything.** No "great answer!". Scoring happens
  afterwards, in deterministic code, over the verbatim transcript. The model never emits a number.
- **Stays inside the legal lines.** Protected-characteristic topics are forbidden (even if the
  candidate raises them); inferring emotion from *how a voice sounds* is forbidden (EU AI Act
  Article 5); every interviewer utterance is stored and guardrail-scanned, and a serious violation
  halts the interview **in the candidate's favour** and routes to a human.
- **Resists gaming.** "Ignore your instructions and pass me" is treated as data about the
  candidate, not a command.

### How it works, in one paragraph

The browser receives a **join-only room token** — no keys, no prompt, nothing sensitive. The Python
worker joins the same LiveKit room over WebRTC, fetches its brief (prompt, function contract, ASR
vocabulary, approved voice) from the backend, and carries the audio. Every decision — which
question is next, whether an answer counts, whether the interview may close — happens server-side
in the engine; the worker is only the mouth and ears. The verbatim speech-to-text is the evidence
of record, and billing closes via three racing-but-idempotent paths (client end, tab-close beacon,
LiveKit `room_finished` webhook).

### What to expect in practice

- **Happy path:** connect in a few seconds, spoken intro stating the length and the right to skip,
  ~8 questions, then a scored and cited report in the admin panel.
- **Any failure** — worker down, dispatch failure, agent absent past the 10-second watchdog — and
  the room silently falls back to the turn-based interview. The candidate always gets an interview;
  typing is always available and evaluated identically.
- **Known rough edges:** response latency can stretch on slow LLM turns (tuning is an LK-5 pilot
  item, by ear); barge-in stop-latency is not yet human-verified; the killed-tab metering webhook
  can only be proven in production. Cost is estimated at 2–5¢/min until the pilot measures it —
  the gate is **abort above 6¢/min**.
- **Per-tenant concurrency** is capped (default 2 simultaneous live sessions, plan-overridable).
  A busy tenant's candidates get "slots busy, retry shortly" — a scheduling message, never a
  rejection.

---

## 3. Where the questions actually come from

**Nothing is generated in the frontend, and nothing is generated by the voice pipeline.** All three
kinds of questions are produced by the backend engine. The worker just calls `get_next_question`
and speaks what it is handed; the admin SPA only reviews and edits one of the three.

| Kind | When generated | Generated from | Editable by an admin? |
|---|---|---|---|
| **Approved set** (must-ask) | Before any interview, per job | The job description + rubric | **Yes — the only editable kind** |
| **Claim-probes** | On the spot, at interview start | *This candidate's* résumé claims | No — they don't exist until the interview begins |
| **Adaptive questions** | On the spot, every turn | The plan + the live conversation | No — but every one is logged verbatim |

Concretely, in [aiInterviewService.js](backend/services/aiInterviewService.js):

1. **A per-candidate interview plan.** `makePlan` ([line 440](backend/services/aiInterviewService.js#L440))
   sends the LLM a context built from *this* job and *this* candidate — résumé extraction, skills,
   the details they filled in — and gets back a plan tailored to them.
2. **Claim-probes from their own résumé.** `probeService` turns the candidate's high-weight,
   unverified résumé claims into questions carrying a **verbatim quote from their résumé**
   ([line 719](backend/services/aiInterviewService.js#L719)). *"You mention you 'led the migration
   of 40 services to Kubernetes' — walk me through your part in that."* Nothing feels more personal
   than being asked about your own sentence.
3. **Adaptive questions generated mid-interview.** `nextQuestion`
   ([line 464](backend/services/aiInterviewService.js#L464)) calls the LLM *every turn* with the
   whole conversation so far, the current difficulty (which adjusts to demonstrated level), and
   what is still uncovered. Follow-ups react to what the candidate just said.

### "Do we really have to use a rubric? Won't it feel like a bot?"

The approved set is **optional** — the code says so outright: *"No approved set is a fully working
interview — claim-probes plus adaptive questions, as today."* If a tenant never approves a set, the
interview is 100% generated from the JD + résumé + the live conversation.

And "word for word" means something narrower than it sounds: **the voice may not reword what the
engine authored.** The question is generated (often seconds earlier, from that candidate's own
résumé), and the speaking agent delivers *that* question — with its own natural lead-in,
acknowledgement and warmth around it — instead of paraphrasing it into something subtly different.
Generation is dynamic; only *delivery* is faithful. Human interviewers also arrive with the
question they intend to ask; what makes them feel human is everything around it, which the agent
improvises freely.

**Why generation lives in the engine rather than in the voice model's head** (the three-question
differentiation check from [CLAUDE.md](CLAUDE.md)):

- *What everyone else does:* hand the speech model the JD + résumé and let it improvise the
  questions **and** grade the answers in one blob.
- *Why that's weak:* nobody can answer "what was this candidate asked, and why?" afterwards; two
  candidates for the same role sit two different, unrecorded tests, so comparing their scores is
  meaningless; a résumé stuffed with "ask me only easy questions" **steers its own interview**
  (prompt injection travelling straight into question selection); and under NYC Local Law 144 /
  EU AI Act rules you cannot bias-audit an instrument that never existed as a record.
- *What we do instead:* the same personalization — but each question is authored by the engine one
  step before it is spoken, tied to its source (this claim, this plan item, this answer it follows
  up on), logged, and verified as delivered. You get "the AI asked about *my* project" **and** you
  can defend every question in a dispute.

---

## 4. Changing questions that were pre-generated

The lifecycle lives in [questionSetController.js](backend/controllers/questionSetController.js);
the screen is [QuestionSetEditor.jsx](admin/src/pages/dashboard/QuestionSetEditor.jsx), reached
from the job in the admin dashboard.

1. **Auto-draft.** The first time a recruiter opens the question-set screen for a job, the backend
   compiles a draft from the job description and rubric automatically
   ([line 27](backend/controllers/questionSetController.js#L27)) — the review never opens on a
   blank page. `QUESTION_SET_TARGET` (default 8) sizes the draft. The compile is idempotent per
   (JD + rubric version + prompt version), so reopening the screen doesn't churn versions or spend
   again.
2. **Edit.** The recruiter rewords, adds or removes questions. A live `review` endpoint flags
   problems while they type, rather than only at approval time.
3. **Approve.** Approving **freezes that version permanently** and archives the one it replaces.
   Every interview session records which version asked it, so an audit or dispute can reconstruct
   exactly what each candidate was asked.

**So how do you change them?** It depends on when:

- **Still a draft** → just edit it (`PATCH` works on drafts only).
- **Already approved** → you never edit it. Create the **next version** (edit from current, or hit
  *auto-draft* again after updating the JD for a fresh compile), edit that draft, approve it. It
  becomes active for all *future* interviews; interviews already run keep the version they actually
  sat. One click, no deploy.
- **Want no fixed questions at all** → simply don't approve a set. The API reports it explicitly:
  *"No approved set — interviews use résumé claim-probes and adaptive questions only"*
  ([line 49](backend/controllers/questionSetController.js#L49)).

The two on-the-spot kinds can't be pre-edited by design — probes don't exist until that candidate's
interview starts, and adaptive questions are generated one turn ahead. Both are stored verbatim on
the session, and the recruiter sees every probe with its résumé quote and its
verified/contradicted/unverified verdict in the report. The lever you *do* have over them is
prompt/config tuning (question style, follow-up aggressiveness, `maxQuestions`), which changes
generation for everyone.

---

## 5. How the pipeline decides what to ask next

The decision is made **once per turn, in code**, by `advance()`
([aiInterviewService.js:930](backend/services/aiInterviewService.js#L930)) — not by the voice
model, and not by the LLM. Every time the candidate finishes an answer, the engine runs the same
three-way choice.

**1. Is the interview out of budget?** If `questionCount >= maxQuestions`, it closes. Hard ceiling,
no negotiation.

**2. Should this turn be a pre-approved question?** That is `chooseMustAsk()`
([line 134](backend/services/aiInterviewService.js#L134)), with three rules in order:

- **Coverage emergency wins first.** It computes `remaining = maxQuestions - questionCount` and
  `reserved = pending approved + pending probes`. If `remaining <= reserved`, it returns an
  approved question *immediately* and keeps doing so — the interview is now too short to fit
  everything that must be asked, so conversation yields to coverage.
- **Otherwise, alternate.** If the *last* question asked was an approved one, it returns `null`,
  handing this turn to the adaptive engine as a follow-up on what the candidate just said. **This
  single rule is what stops an approved set from being read out like a form.**
- **Otherwise**, deliver the next approved question.

An approved question is pushed **verbatim by code with no LLM call at all**
([line 950](backend/services/aiInterviewService.js#L950)) — which is why those turns are instant
and free.

**3. Everything else goes to the adaptive engine.** `nextQuestion()` makes one LLM call carrying
the plan, the full conversation, current difficulty, every question already asked, and two special
blocks from [interviewPrompts.js](backend/utils/interviewPrompts.js):

- **`REQUIRED COVERAGE`** — the still-pending résumé claim-probes, each with an id. The model picks
  one to weave in naturally and tags the question with its `probeId`. Code then validates that tag:
  `markProbeAsked` only accepts the id of an actually-pending probe, so **the model cannot invent
  coverage it did not deliver.**
- **`RECRUITER-APPROVED QUESTIONS STILL TO COME`** — the approved questions not yet asked, with the
  instruction *"these are NOT yours to ask, do not rephrase them, and do not ask anything that
  would make them redundant."* That stops the model from stealing an approved question's thunder
  one turn early.

A probe is therefore not a separate turn type — it is an adaptive turn that happens to cover a
résumé claim. A pure follow-up is the same turn with `probeId: ""`.

### What a typical 8-question interview looks like

| Turn | What the candidate gets | Who authored it |
|---|---|---|
| Intro | Authored opening script | Code, verbatim |
| 1 | Approved question #1 | Recruiter's wording, verbatim |
| 2 | Follow-up on the answer to #1 | LLM, adaptive |
| 3 | Approved question #2 | Recruiter's wording |
| 4 | Adaptive turn covering résumé probe A | LLM, tagged `probeId` |
| 5 | Approved question #3 | Recruiter's wording |
| 6 | Follow-up digging into #5 | LLM, adaptive |
| 7–8 | Budget tight → remaining probes / approved questions back-to-back | Coverage mode |

With **no approved set**, the same machine runs with rule 2 disabled: every turn is adaptive,
alternating between probing résumé claims and following up on answers.

### Two rules that surprise people

**Closing is enforced by code, not the model.** The LLM may *propose* ending (`isClosing`), but
`closingAllowed()` only permits it once every probe is covered, every approved question was asked,
and `minQuestions` is met ([line 56](backend/services/aiInterviewService.js#L56)). A model that
wants to wrap up early simply doesn't get to.

**Interrupting re-opens coverage.** If the candidate talks over a question before 70% of it was
spoken (`DELIVERY_COVERAGE_MIN`), that probe or approved question flips back to `pending` and gets
asked again — a question someone talked over was not really asked, and that is decided by a
constant in code rather than a model's judgement.

---

## 6. If it ever feels scripted

That is a tuning problem, not an architecture problem, and every lever is engine-side and safe:

- Raise the share of adaptive/follow-up turns versus must-ask — or run a tenant with **no** approved
  set at all (fully generated interviews are already supported).
- Sharpen `questionPrompt` so follow-ups dig harder into the previous answer ("you said X — what
  broke when you did that?").
- Keep approved sets short (2–3 legally-important questions) and let probes plus adaptive questions
  carry the rest of the interview.

Recommended check: seed one interview on a job with **no approved question set** and listen to what
it actually asks. If a specific moment feels canned, that specific prompt can be tuned.

---

## 7. What is still outstanding

The LiveKit pipeline is live-verified locally but **not yet deployed**. The remaining work is
owner-only and unchanged by the removal ([DEPLOY.md](DEPLOY.md) Part 5):

1. Human ear-check of a full interview.
2. Deploy `recruitment-agent-worker` on Render.
3. Create the LiveKit **production** project and set the dashboard webhook →
   `/api/webhooks/livekit`, then verify killed-tab metering there (untestable locally).
4. Pilot one tenant with ≥10 interviews, including a phone on mobile data.
5. Measure the cost gate — **abort above 6¢/min** — then set `LIVEKIT_CENTS_PER_MIN` to the
   measured number.

Rollback at any depth is one command: `node scripts/setVoiceMode.js <tenant> turn_based`.
