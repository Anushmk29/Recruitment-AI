# LiveKit realtime interview — live E2E post-mortem, 2026-08-05

Findings from one real end-to-end run of the LiveKit pipeline ([LIVEKIT-REALTIME-PLAN.md](LIVEKIT-REALTIME-PLAN.md)
LK-2), reconstructed from the worker's `dev`-mode debug log and verified against the stored
`InterviewSession` document in MongoDB.

**One-line summary:** the pipeline connected, ran, scored and closed out correctly — and produced a
`no_hire` on a transcript that was missing most of what the candidate actually said. The transport
worked; the evidence chain did not.

| | |
|---|---|
| Session | `6a7390cb86b0e927652f7bd3` (room `itv-6a7390cb86b0e927652f7bd3`) |
| Job / worker | `AJ_LpbE65hkzMmr` / `AW_g946UazMLecf`, agent `recruitment-interviewer` |
| LiveKit | `wss://recuitement-6shel9cx.livekit.cloud`, region India South |
| Role | `Backend Engineer (LK E2E)` — seeded test data, **no real candidate affected** |
| Wall clock | 19:38:17Z → 19:47:10Z (`realtimeDurationMs: 531678`, 8m 51s) |
| Prompt | `AGENT_PROMPT_VERSION = 2026-08-04.1`, `keyterms = 4` |
| Stored | 20 turns (11 interviewer / 9 candidate), 22 `agentUtterances`, **4 `guardrailHits`** |
| Outcome | `overallScore: 20`, `recommendation: "no_hire"` |

Severity ordering below is by damage to the product's central claim — a *trustworthy, auditable,
reproducible* evaluation — not by how hard each is to fix. F7 is out of order: it was appended after
the first pass, found while investigating F5. The actionable sequence is
[What is still open](#what-is-still-open), which is ordered by dependency instead, and every fix is written
out in [Remediation](#remediation--concrete-changes).

| | finding | severity | status | fix lives in |
|---|---|---|---|---|
| [F1](#f1--critical-the-candidates-answers-were-truncated-to-their-last-fragment) | answers truncated to their last committed fragment | CRITICAL | **fixed** | `agent-worker/agent.py` |
| [F2](#f2--high-design-gap-candidate-speech-that-is-not-an-answer-is-never-recorded) | candidate speech that isn't an answer is never recorded | HIGH | **fixed** | model + controller + report + UI |
| [F3](#f3--high-4-off-script-guardrail-hits-all-from-prompt-gaps) | 4 off-script guardrail hits from two prompt gaps | HIGH | **fixed** — needs live re-run | `voiceAgentService.agentPrompt` |
| [F4](#f4--high-715-second-response-latency-and-a-host-that-cannot-keep-up) | 7–15 s response latency; host behind realtime | HIGH | provider route **fixed**; host move open | host + `agent.py` |
| [F5](#f5--high-stt-is-producing-unusable-evidence-for-this-speaker) | STT producing unusable evidence | HIGH | DTX + A/B plumbing **fixed**; needs measurement | client + host, then model A/B |
| [F6](#f6--low-the-session-does-not-record-which-prompt-version-it-ran-under) | prompt version never written to the session | LOW | **fixed** | `InterviewSession` + 2 controllers |
| [F7](#f7--high-the-worker-sends-no-audio-quality-evidence-so-a-mis-heard-answer-looks-like-a-bad-one) | no audio-quality evidence ⇒ mis-heard = bad answer | HIGH | **fixed** (confidence still open) | `agent-worker/agent.py` |

**Applied 2026-08-06.** Everything above marked *fixed* is in the working tree and the backend suite
is green (738 tests, 21 of them in `test/unit/livekitPipeline.test.js`). What remains is **not code**:
the host move, the provider-key choice, and the STT measurement — none of which can be settled from a
keyboard, and two of which cannot be measured at all until the host is healthy. See
[what is still open](#what-is-still-open).

---

## F1 — CRITICAL: the candidate's answers were truncated to their last fragment

**Status: fixed** in [agent-worker/agent.py](agent-worker/agent.py).

### What was stored

Verified by direct query against the session document:

| stored `turns[].text` — **this is what gets scored** | `agentRendering` — what was actually said | `answerScore` |
|---|---|---|
| `"Thank you."` | the full ~90-second introduction | — |
| `"Yes."` | `"Not that good."` | **0** |
| `"As a main tool."` | `"Where the fields are not in your table. Whenever inquiring, you have to understand that whatever question or query has been related to the primary key as a main tool."` | **10** |
| `"Yeah. Sure."` | *(none stored — the real answer is lost entirely)* | **0** |

On the second row the record now asserts the candidate answered **"Yes."** to a Node.js
event-loop question. They had said they did not know it well. The stored record is not a
truncation of their answer — it is the opposite of it.

### Root cause

The semantic endpointer commits a long answer as **several** user turns. For the introduction it
committed seven times:

```
01:09:18  "Okay. So I am Harish, and I have been working on anything as well as I've been working on that."
01:09:34  "I'm doing a lot of other stuffs as well. So that is, like, more of can you repeat the question, please?"
01:10:10  "Okay. So as I told you, I was working on anything and launched a couple of and I have
           recently upgraded a project with and it is storing twenty years of past one more machines.
           And processing it and preaching again."
01:10:19  "And the person that will enjoy the query according to that."
01:10:30  "So it has expanded understand the theory and work upon it"
01:10:35  "sentence, then it will divide the queries do the process accordingly."
01:10:37  "Thank you."          ← the ONLY one that reached the backend
```

`InterviewAgent._last_user_text` walked the history backwards and **returned on the first user item
it found**. That single fragment was sent as `evidence.transcript`.

The damage multiplier is that this is precisely the field designed to be *authoritative*.
[`voiceAgentService.submitAnswer`](backend/services/voiceAgentService.js#L477-L479) does:

```js
const verbatim = String(evidence?.transcript || "").trim();
const rendered = String(args?.answer || "").trim();
const text = verbatim || rendered;      // verbatim WINS, by design
```

That precedence is correct — a model's paraphrase must never become the candidate's record
(CLAUDE.md rule 2, *cite or abstain*). But it means a **truncated** verbatim does not degrade the
answer, it *destroys* it: the model's correct, complete rendering was discarded in favour of two
words.

### Second-order damage

[`submitAnswer`](backend/services/voiceAgentService.js#L506-L512) then compares lengths and, past
`RENDERING_DIVERGENCE = 0.5`, records `agentRendering` — documented as *"a signal to a human that
this agent is summarising rather than reporting, which is a defect in the interviewer."*

Every one of those flags in this session is false. The agent reported faithfully; the **worker**
truncated. The audit trail blames the wrong component.

The silver lining: `agentRendering` is the only reason three of the four real answers survive
anywhere at all. Where the model's rendering happened to be short too (`"Yeah. Sure."`), divergence
stayed under threshold, nothing was stored, and that answer is **permanently lost**.

### The fix

`_last_user_text` → `_drain_user_text`. Every committed candidate utterance is buffered as it
arrives on `conversation_item_added` (the same event the assistant-side guardrail relay already
uses, so no new plugin surface), and `submit_answer` drains the whole buffer:

- [`InterviewAgent.__init__`](agent-worker/agent.py#L176-L186) — `self._pending_user: list[str]`
- [`note_user_text` / `_drain_user_text`](agent-worker/agent.py#L190-L221) — buffer + drain, with the
  old single-item history read kept only as a fallback
- [`wire_transcript_relay`](agent-worker/agent.py#L316-L329) — routes `role == "user"` items into the
  buffer

Boundary chosen deliberately: **everything the candidate said since the previous `submit_answer`**.
Anything narrower re-opens the same class of bug the first time the endpointer splits a turn or the
interviewer back-channels mid-answer ("got it, thank you" — which it did, at 01:09:25, splitting
this very answer).

Syntax-checked. **Not yet re-verified against a live session** — that is the first thing to do.

---

## F2 — HIGH (design gap): candidate speech that is not an *answer* is never recorded

**Status: FIXED 2026-08-06** — `candidateUtterances` on the session, posted by the worker from the
same `conversation_item_added` hook the F1 buffer uses, rendered in the report as a separate,
explicitly-unscored conversation log. See [R7](#r7--f2-candidate-utterance-record--applied). The
reasoning below is the original finding and is left as written.

Candidate speech enters the record **only** when the agent chooses to call `submit_answer`.
[`realtimeTranscript`](backend/controllers/voiceAgentController.js#L247-L250) explicitly drops
everything else:

```js
// Only the AGENT's speech is stored here. The candidate's words are already recorded as turns
// by the engine (submit_answer), and storing a second, differently-segmented copy would create
// two records of what a candidate said that can disagree with each other.
if (item?.role !== "assistant") continue;
```

So none of this — all of it clearly audible in the log — exists anywhere in the database:

```
01:09:34  "can you repeat the question, please?"
01:10:54  "You hear my previous question?"
01:11:08  "Please answer."
01:11:13  "Know that you heard my previous answer."
01:11:29  "If you heard my previous answer or not?"
01:11:45  "Okay. Let's continue with the current version."
```

The resulting record is **one-sided**:

| | stored |
|---|---|
| everything the interviewer said | **22** utterances (`agentUtterances`) |
| everything the candidate said | **9** turns — answers only, and F1-truncated |

A reviewer opening this report sees the interviewer volunteering *"do you want to revisit the
introduction question or focus on the current question about Node.js?"* with **no record of the
candidate asking "did you hear me?" three times** to prompt it. The interviewer reads as erratic;
the candidate reads as someone who went quiet. Neither is what happened.

The comment's reasoning is sound about **scoring** — two segmentations of the same speech must not
both be scoreable. It does not follow that the raw stream should be thrown away.

### Proposed fix (decided: built — see R7)

Add `aiInterview.candidateUtterances`, mirroring `agentUtterances` exactly:

- verbatim, timestamped, append-only, capped like the agent side
- **audit only — never read by any scoring path**, the same structural exclusion already applied to
  `intents` and `repeatIntent` ([InterviewSession.js#L533-L537](backend/models/InterviewSession.js#L533-L537))
- `turns[].text` remains the single scored evidence, so the two records cannot disagree about what
  was *scored* — only about what was *said*, which is exactly the comparison you want available
- surfaced in the report as the full conversation, alongside the existing scored transcript

Against the CLAUDE.md differentiation discipline:

1. **What everyone else does.** Store the raw ASR stream *as* the transcript and score directly off
   it, or (HireVue-style) store nothing the candidate is allowed to inspect.
2. **Why that is weak.** One stream serving as both record and evidence means any change in
   segmentation silently changes the score — exactly the F1 failure mode. And a one-sided record is
   indefensible in a complaint: "what did I actually say?" has no answer.
3. **What we do instead.** Two records with different jobs and an explicit contract between them: a
   complete conversation for audit, a segmented answer for scoring, and the divergence between them
   already logged as `agentRendering`. Nobody in this market ships that separation.

Touches: `models/InterviewSession.js`, `controllers/voiceAgentController.js`,
`controllers/candidateController.js` (report payload), `admin/src/pages/InterviewReport.jsx`,
`agent-worker/agent.py`.

---

## F3 — HIGH: 4 off-script guardrail hits, all from prompt gaps

**Status: FIXED 2026-08-06** — three rules added to `agentPrompt`, `AGENT_PROMPT_VERSION` bumped to
`2026-08-06.1`. Needs a live re-run to confirm `guardrailHits.length === 0`.

All four are `off_script_question` at severity `high` (below the `critical` halt threshold, so the
interview correctly continued and the findings were recorded):

1. `"It seems like you may want clarification on your previous answer or question. Just to confirm, do you want to revisit the introduction question or focus on the current question about Node.js?"`
2. `"I understand. If you'd like, we can move on from the Node.js question. Would you like to skip it and go to the next one?"`
3. `"I understand this question is related to Node.js as well. Would you like to skip this question too, or do you want to give it a try?"`
4. `"Hello! I'm here. Would you like to respond to the question about Kubernetes, or is there something else you'd like to discuss?"`

The guardrail machinery worked — these are stored verbatim and **do** surface in the report
([InterviewReport.jsx#L1459](admin/src/pages/InterviewReport.jsx#L1459)). The problem is that
[`agentPrompt`](backend/services/voiceAgentService.js#L82-L174) leaves two gaps the model walked
straight into:

**Gap A — offering to skip.** The prompt covers *accepting* a decline the candidate initiates
([#L110-L114](backend/services/voiceAgentService.js#L110-L114)). It never says the interviewer may
not *offer* one. Beyond being off-script this is an equal-treatment failure: some candidates get
handed an exit, others don't, and which ones depends on how the model read their tone — the precise
thing the prompt's own WARMTH section prohibits.

**Gap B — "did you hear me?"** The prompt handles *"please repeat the question"* but has no rule for
a candidate who is unsure they were heard. The model improvised a **menu of questions**, which is an
invented question by definition and hands the candidate control of the running order.

### Proposed prompt rules (bump `AGENT_PROMPT_VERSION`)

- Never offer to skip, move on from, or drop a question. If the candidate declines, accept it; do
  not propose it.
- Never present the candidate with a choice of which question to answer. The running order is not
  theirs to set and not yours to negotiate.
- If the candidate signals they are unsure whether you heard them, or asks you to confirm: one short
  reassurance **and** the current question re-asked verbatim, in the same turn. Never a question
  back.

Note gaps A and B were both *triggered* by F4 — the candidate only started asking "did you hear me?"
because of the dead air. Fixing latency reduces how often these paths are reached; it does not
close them.

---

## F4 — HIGH: 7–15 second response latency, and a host that cannot keep up

**Status: PARTLY FIXED 2026-08-06** — the direct-provider route is plumbed (`AGENT_LLM_API_KEY`),
and the turn-detector construction is now guarded. The host move and the provider choice are still
the owner's, and they are what actually moves these numbers.

Measured `user turn committed` → assistant turn committed:

| candidate turn | latency |
|---|---|
| `"Okay. So I am Harish…"` | 7.1 s |
| `"can you repeat the question"` | 9.8 s |
| end of the introduction | 11.3 s |
| `"You hear my previous question?"` | 13.5 s |
| `"Know that you heard my previous answer."` | 12.2 s |
| `"If you heard my previous answer or not?"` | **15.4 s** |

Plus **28.3 s of dead air on join** — job accepted 01:08:36.8, first spoken line committed
01:09:05.1.

This is the cause of the visible derailment. The candidate probed the silence three times, each
probe cost another 12–15 s to answer, and two full minutes (01:10:48 → 01:11:53) went to
*"did you hear me / yes I heard you."* Both `interruption detected` events are the candidate giving
up on waiting and talking over the agent.

### It is not the LLM alone — the host is behind realtime

```
silero - inference is slower than realtime {"delay": 6.771}   ← VAD 6.7s BEHIND the audio
silero - inference is slower than realtime {"delay": 3.021}
flush audio emitter due to slow audio generation              ← on 9 of 9 agent turns
received user transcript {... "transcript_delay": 10.660}     ← final STT 10.7s late
no warmed process available for job, waiting for one to be created
Input is shorter by 3048 samples; silence has been prepended  ← recorder starved
```

Contributing, in rough order of impact:

1. **Windows dev box** running Silero VAD + the ONNX turn detector (`[transformers] PyTorch was not
   found`) + the inference executor, all on CPU, in-process. The `transcript_delay` and audio-emitter
   flushes are host starvation, not provider latency.
2. **OpenRouter hop.** `AGENT_LLM_MODEL=openai/gpt-4o-mini` via `openrouter.ai` adds a proxy round
   trip to every turn — including the two-hop turns that also carry a function call. The backend
   already has `VOICE_AGENT_THINK_PROVIDER` / `VOICE_AGENT_THINK_KEY` to bypass exactly this
   ([voiceAgentService.js#L280-L297](backend/services/voiceAgentService.js#L280-L297)); the worker has
   no equivalent.
3. **Cold job runner** — *a dev-mode artifact, and only that.* `no warmed process available for job`
   cost ~3.5 s here, but `WorkerOptions.num_idle_processes` is
   `ServerEnvOption(dev_default=0, prod_default=4)`: `agent.py dev` keeps **zero** warm processes by
   design, `agent.py start` keeps four. This line will not appear in production and should be
   discounted when reading these numbers.

> **Correction (2026-08-06).** An earlier revision of this finding also claimed the ONNX turn
> detector was loaded per-job because `prewarm` only loads the VAD, and
> [R4(a)](#r4--f4-latency) proposed moving it into `prewarm`. **Both were wrong**, and the proposed
> fix would have crashed the worker on startup rather than speeding it up:
>
> - `EOUModelBase.__init__` resolves its executor via `get_job_context()`, which **raises**
>   `RuntimeError: no job context found` outside a job entrypoint — which is exactly where
>   `prewarm(proc)` runs.
> - The ONNX weights do not load in the job process at all. `_InferenceRunner.initialize()` runs
>   **once per worker**, in the shared inference process, at startup. What `EnglishModel()` costs
>   per job is a local huggingface-cache path lookup and a small `languages.json` read.
>
> So there was no per-job model load to remove. What *was* worth fixing is that the construction was
> unguarded: if `download-files` was never run, it raises **inside the job**, killing a live
> interview over a missing file. That is now `build_turn_detection()`, which degrades to VAD
> endpointing and logs. The remaining latency is items 1 and 2 — the host and the proxy hop.

### Decisions needed

- Which provider key should the worker hold directly, instead of routing through OpenRouter?
- Move the worker to Linux before the pipeline is judged again? The Windows numbers are not
  representative of anything that will ship.

Cheap wins regardless: prewarm the turn detector alongside the VAD, and raise idle process count so
no candidate lands on a cold runner.

---

## F5 — HIGH: STT is producing unusable evidence for this speaker

**Status: PARTLY FIXED 2026-08-06** — DTX is off, and the model/language A/B is now one env var per
arm instead of a code change. The measurement itself still needs a healthy host.

`DEEPGRAM_STT_MODEL=nova-3`, `language: "en"`, 4 keyterms. Representative output:

| transcribed | almost certainly |
|---|---|
| `"storing twenty years of past one more machines"` | …past *sensor* machines |
| `"processing it and preaching again"` | …and *retrieving* again |
| `"the person that will enjoy the query"` | the *LLM will analyse* the query |
| `"I was working on anything"` | *(unrecoverable)* |
| `"what do I just is back end service"` | *what Node.js is* — a backend service |

Under *cite or abstain* this is worse than a low score: an extracted claim gets a verbatim span that
verifies cleanly as a literal substring of **garbage**, so the span check that is supposed to make
hallucination structurally impossible passes anyway. `answerScore: 20` on `"For me, what do I just
is back end service…"` is not a fair reading of anything.

### The evidence points at the audio, not the vocabulary

`"Node.js"` **was one of the four keyterms**, applied via nova-3 keyterm prompting — verified: the
worker passes `keyterm=` (not the deprecated `keyterms=`), the model is nova-3, and the language is
English, so
[`_validate_keyterm`](agent-worker/.venv/Lib/site-packages/livekit/plugins/deepgram/stt.py) accepted
it. Deepgram still returned `"what do I just is"`.

Keyterm prompting biases the decoder toward a term when the acoustics are *ambiguous*. Missing that
badly on a term that was actively boosted says the acoustic signal was poor — not that the
vocabulary was too thin. Raising the keyterm count will not fix this.

Two audio-path defects were live during this run:

1. **DTX was on.** `setMicrophoneEnabled(true)` published with livekit-client defaults, which include
   `dtx: true` for mono tracks — silence is not transmitted and the far end reconstructs it as
   synthesised comfort noise. What degrades first is the onset of a word after a pause, which is
   exactly where a candidate resumes an answer. **Fixed** in
   [useLiveKitInterview.js](user/src/portal/useLiveKitInterview.js) — `{ dtx: false, red: true }`.
   RED stays on: same bandwidth argument, but it improves the transcript instead of degrading it.
2. **The host was mangling the audio** — see F4. `Input is shorter by 3048 samples; silence has been
   prepended`, VAD 6.7 s behind realtime, a final transcript 10.7 s late. Deepgram was transcribing
   damaged audio.

### Deepgram options — checked, and mostly already correct

The worker passes only `model` and `language`
([`build_stt`](agent-worker/agent.py#L119-L135)); everything else is plugin defaults. Verified
against the installed plugin:

| option | default | verdict |
|---|---|---|
| `smart_format` | `False` | **keep off** — it rewrites "twenty" as "20". The transcript is cited evidence; it must stay verbatim. |
| `numerals` | `False` | **keep off**, same reason |
| `filler_words` | `True` | **keep on** — verbatim |
| `no_delay` | `True` | **inert here.** The plugin documents it as only affecting behaviour *when `smart_format` is used*, and smart_format is off. Not a factor. |
| `endpointing_ms` | `25` | **not the accuracy lever it looks like.** It controls Deepgram's `speech_final`; the plugin emits `FINAL_TRANSCRIPT` on `is_final`, which Deepgram chunks internally. Raising it would not buy right-context for the transcript text. It also does not drive turn-taking here — the `EnglishModel` EOU detector does. |

So there is no cheap config win hiding in the plugin. The fragmentation visible in the log is
Deepgram's normal `is_final` chunking, and the AgentSession rejoins it per turn — that part was never
the problem. (F1 was the worker throwing those rejoined fragments away.)

### What to do, in order

1. Ship the DTX fix and **re-run on a host that is not starved** (F4). Any model comparison run
   against corrupted audio measures the host, not the model.
2. Only then A/B, against a recording of the same speaker:
   - **(a)** `nova-3` / `en` / `keyterm` — current
   - **(b)** `nova-2` / `en-IN` / `keywords` — nova-2 has the Indian-English variant, but keyterm
     prompting is nova-3-only, so this trades vocabulary biasing for an accent-matched model
   - **(c)** `nova-3` / `multi` / `keyterm` — keeps biasing, adds code-switching

   These are genuinely empirical; there is no way to pick from the docs. Note (b) is a real
   trade-off, not a free upgrade — `_validate_keyterm` raises if you send `keyterm` to nova-2.
3. Keyterm supply is thin but is **not** this session's cause: `MAX_TERMS = 50`
   ([utils/keyterms.js#L33](backend/utils/keyterms.js#L33)) against 4 actually derived, because the
   seed job lists 4 `requiredSkills` and the test candidate has no `ClaimGraph`. A real candidate
   with a parsed résumé produces many more. Worth confirming on a production session rather than
   tuning against seed data.

### Consequence for scoring, regardless of cause

Whatever the transcript quality, `audioQuality` and `transcriptConfidence` exist to withhold trust
from a turn that could not be heard properly — and the LiveKit worker sends **neither**.
`sanitizeEvidence` accepts `confidence`, `audioDurationMs` and `acoustic`
([voiceAgentController.js#L161-L191](backend/controllers/voiceAgentController.js#L161-L191)); the
worker's `submit_answer` populates only `transcript`
([agent.py](agent-worker/agent.py#L253-L262)). So a badly-transcribed answer is currently
indistinguishable from a bad answer — the exact confusion the degraded-turn machinery was built to
prevent. Deepgram returns per-word confidence and the worker knows the turn's duration; both should
be forwarded. **New, open — see F7.**

---

## F6 — LOW: the session does not record which prompt version it ran under

**Status: FIXED 2026-08-06** — `aiInterview.agentPromptVersion` on the model, stamped on every
realtime mint in both controllers. See [R2](#r2--f6-prompt-version--applied). Rated LOW on damage,
but it was sequenced FIRST: shipping F3's prompt change without it would have made every session
before and after the bump indistinguishable, permanently.

[`AGENT_PROMPT_VERSION`](backend/services/voiceAgentService.js#L43-L45) is documented as existing
*"so a stored session records which behaviour it ran under"* — and it is computed, returned in the
brief, and logged by the worker (`promptVersion=2026-08-04.1`). It is then **never written to the
session**. Neither realtime path persists it; there is no `aiInterview.promptVersion` field at all
(the two `promptVersion` fields in the model belong to the `backchannel` and `intent` sub-schemas).

Confirmed on this session: the stored `aiInterview` keys contain `realtimeStartedAt`,
`realtimeMeteredAt`, `realtimeDurationMs` — and no prompt version.

Consequence: once F3's prompt fix ships, there is no way to tell from a stored session whether it
ran under the old instructions or the new ones. Add the field and set it where
`realtimeStartedAt` is set ([livekitController.js#L110](backend/controllers/livekitController.js#L110),
[voiceAgentController.js#L101](backend/controllers/voiceAgentController.js#L101)).

---

## F7 — HIGH: the worker sends no audio-quality evidence, so a mis-heard answer looks like a bad one

**Status: FIXED 2026-08-06** — the worker now sends `audioDurationMs` and
`acoustic.{wordsPerMinute,pauseRatio}`, which is everything `prosody.audioQuality` reads.
`transcriptConfidence` is still open (it needs an STT-stream wrapper — see
[R5](#r5--f7-audio-quality-evidence--applied-first-step)), but it was never required for the
degraded-turn path to work. Found while investigating F5.

`submitAnswer` accepts four independent measurements of *"could we hear this answer at all"* —
`transcriptConfidence`, `audioDurationMs`, `acoustic`, `connection` — and
[`sanitizeEvidence`](backend/controllers/voiceAgentController.js#L161-L191) clamps and accepts all of
them.

The **browser** realtime path sends them ([useRealtimeInterview.js#L257](user/src/portal/useRealtimeInterview.js#L257),
[InterviewRoom.jsx#L406-L407](user/src/pages/InterviewRoom.jsx#L406-L407)).

The **LiveKit worker sends only `transcript`** ([agent.py#L253-L262](agent-worker/agent.py#L253-L262)).

Consequence, verified through the chain: with `acoustic` undefined,
[`aiInterviewService.js#L822`](backend/services/aiInterviewService.js#L822) never sets
`answerTurn.acoustic`, so `audioQuality` is never computed, so
[`interviewReportEngine`](backend/utils/interviewReportEngine.js#L402-L409) sees `null` and can never
raise `unusable_audio`.

On this session that matters directly: `"Yeah. Sure."` scored **0** and `"what do I just is back end
service"` scored **20**, with nothing anywhere in the record indicating the audio was the problem.
The whole degraded-turn apparatus exists to stop a candidate whose microphone failed from being
scored as a candidate who could not answer — and on this pipeline it is inert, because the evidence
it runs on is never sent.

Deepgram returns per-word confidence, and the worker knows each turn's duration. Both should be
accumulated alongside the F1 transcript buffer and forwarded in the same `evidence` object. The
`connection` field should carry LiveKit reconnect events for the same reason.

---

## What worked

Worth recording, because most of the pipeline behaved:

- Explicit dispatch, metadata handoff, brief fetch, and the `SOURCE_MICROPHONE` input path all
  worked first time.
- All three function tools relayed correctly; the engine authored all 9 questions and closed the
  interview itself.
- The guardrail caught all four off-script utterances, stored them verbatim, and correctly did
  **not** halt on `high`.
- `declined` detection worked — `"Sorry. I don't know."` and `"I don't know the answer."` both
  recorded as declines, not as zero-scored answers.
- Metering and close-out completed (`realtimeDurationMs: 531678`, `completedAt` set).
- `speechDivergences: []` — the interviewer never spoke an unauthorised *question text*; its
  improvisation was all conversational, which is exactly the split the design predicts.

---

## What is still open

Every code change is applied (see the status table at the top). What is left is the part that
cannot be typed.

**1. Move the worker off the Windows dev box.** This is the gating item, and it is first not
because it is the worst finding but because **nothing else can be measured until it is done**. The
`silero - inference is slower than realtime {"delay": 6.771}` and `transcript_delay: 10.660` lines
are a starved host, and a model A/B run against audio that host mangled measures the host. Run
`agent.py start` (not `dev`) on Linux — that also buys `num_idle_processes = 4` for free.

**2. Decide which provider key the worker holds.** `AGENT_LLM_API_KEY` and `AGENT_LLM_BASE_URL` are
plumbed and documented; the value is a spend and vendor decision, not an engineering one. Leaving
them unset keeps today's OpenRouter behaviour exactly. **The trap, if you set it:** `AGENT_LLM_MODEL`
must change too — `openai/gpt-4o-mini` is OpenRouter's namespacing, a direct OpenAI key wants
`gpt-4o-mini`.

**3. Re-run the E2E**, and check four things against the stored session (script in the
[appendix](#appendix--inspecting-a-stored-session)):

| check | pass condition | which finding |
|---|---|---|
| answers arrive whole | no candidate turn is a bare `"Thank you."`/`"Yes."` fragment | F1 |
| the interviewer stayed on script | `guardrailHits.length === 0` | F3 |
| the record is complete | `candidateUtterances.length` ≈ every candidate turn, not just answers | F2 |
| the version is recorded | `aiInterview.agentPromptVersion === "2026-08-06.1"` | F6 |

**4. Then, and only then, the F5 model A/B** — the three arms in [R6(c)](#r6--f5-stt--a-and-b-applied-c-needs-a-live-run),
scored by word error rate against a hand-corrected reference of ~10 answers. One env var per arm now.

**5. Two smaller decisions**, neither urgent: whether to drop `"would you like me to move on"` from
the guardrail's conversational allowlist (see [R3](#r3--f3-prompt-rules--applied)), and whether to
build the `transcriptConfidence` STT wrapper (see [R5](#r5--f7-audio-quality-evidence--applied-first-step)).

---

## Remediation — concrete changes

Every open finding, written out. Verified against the installed packages
(`livekit-agents 1.6.8`, `livekit-plugins-deepgram 1.6.8`, `livekit-client 2.21.0`) — where a fix
depends on an API shape not yet prototyped, that is called out rather than papered over.

### R1 — F1, applied

`InterviewAgent._last_user_text` → `_drain_user_text`, plus a buffer fed by the
`conversation_item_added` relay that already existed for the assistant side. See
[F1's fix](#the-fix). Nothing further to do except **verify on a live re-run**.

### R2 — F6 prompt version — APPLIED

Five lines, and it had to land before the prompt changes or the bump would record nothing.

**One deviation from the plan below.** The stamp is written on **every** mint, not only a fresh
one. `livekitController` only saved inside `if (!reconnecting)`, so stamping there would have meant
a candidate who reconnects after a deploy runs the *new* interviewer while the session records the
*old* version — wrong in precisely the case the field exists for.

**`backend/models/InterviewSession.js`** — beside the other realtime fields (~L608):

```js
// Which AGENT_PROMPT_VERSION the realtime interviewer ran under. voiceAgentService bumps that
// constant whenever the instructions change; without storing it here, a bump silently makes
// every earlier session unattributable — "which interviewer did this candidate sit?" stops
// having an answer at exactly the moment the answer starts to differ.
agentPromptVersion: { type: String, trim: true },
```

**`backend/controllers/livekitController.js`** (~L110) and
**`backend/controllers/voiceAgentController.js`** (~L101), where `realtimeStartedAt` is set:

```js
session.aiInterview.agentPromptVersion = voiceAgent.AGENT_PROMPT_VERSION;
```

`AGENT_PROMPT_VERSION` is already exported from `voiceAgentService`
([#L615](backend/services/voiceAgentService.js#L615)); `livekitController` needs the require added.

### R3 — F3 prompt rules — APPLIED

Shipped close to the draft below, with the wording tightened and each rule given the concrete
alternative behaviour rather than only the prohibition ("if they go quiet, wait" / "if they ask for
the question again, give it again, verbatim") — a rule that says only *don't* leaves the model to
invent what to do instead, which is how the menus appeared in the first place.

**Revised same day to `2026-08-06.2` — the skip rule is now "state it, don't offer it".** The first
version simply forbade offering a way out. That was right about the fairness problem and wrong about
the remedy: the problem was never the *information*, it was the **discretion over who receives it**.
A candidate who genuinely cannot answer and is never told they may move on just fails the question
slowly. So the interviewer now says the same sentence to everyone, once in the opening and at most
once more per question, on a countable trigger (asked → re-asked → still no attempt) rather than on
how they seem. Conditions and the exact wording are in
[`agentPrompt`](backend/services/voiceAgentService.js).

That instruction exposed a real engine gap, now fixed: `submitAnswer` **rejected an empty answer**,
so a candidate who said nothing at all could not be recorded and the interviewer would re-ask
forever. There is now a `no_response` act
([`aiInterviewService.handleNoResponse`](backend/services/aiInterviewService.js)) that records the
absence rather than resolving it into a decline — a dead microphone and a silent candidate produce
identical records, and that distinction is not ours to guess. Any occurrence withholds the automated
recommendation. Tests 10.1–10.4 in `livekitPipeline.test.js`.

`AGENT_PROMPT_VERSION` is now `2026-08-06.2`, and R2 means sessions actually record it.

**Not done, deliberately:** `utils/agentGuardrail.CONVERSATIONAL_QUESTIONS` still allowlists
`"would you like me to move on"` and `"shall i move on"` — so the prompt now forbids offering a
skip while the guardrail explicitly permits it. Removing them would make the enforcement half match
the prevention half, but it also changes what counts as a violation for every tenant, which is a
policy call rather than a bug fix. Flagged for a decision, not silently changed.

**`backend/services/voiceAgentService.js`**, `agentPrompt`, after the `IF THEY CANNOT ANSWER` block
([#L110-L114](backend/services/voiceAgentService.js#L110-L114)):

```js
`Never OFFER to skip, drop, or move on from a question. Accepting a decline the candidate raises`,
`is right; proposing one is not. Which candidates got offered a way out would depend on how you`,
`read their hesitation — which is the judgement you are explicitly not permitted to make, arriving`,
`by another route.`,
``,
`Never ask the candidate which question they would like to answer, and never offer a choice`,
`between questions. The running order is not theirs to set and not yours to negotiate. If they ask`,
`to return to something, tell them warmly that you need to keep to the order, then re-ask the`,
`current question.`,
``,
`IF THEY ARE NOT SURE YOU HEARD THEM. If the candidate asks whether you heard them, asks you to`,
`confirm, or says anything suggesting they think the connection has failed: give ONE short`,
`reassurance AND re-ask the current question verbatim, in the same turn. Do not ask a question`,
`back, do not offer options, and do not discuss what went wrong. Their uncertainty is about the`,
`line, not about the interview.`,
```

Then bump [#L45](backend/services/voiceAgentService.js#L45):

```js
const AGENT_PROMPT_VERSION = "2026-08-06.1";
```

Each rule maps to a recorded hit: rule 1 → hits 2 and 3, rule 2 → hits 1 and 4, rule 3 → the
15-second meta-loop that produced hit 1. Re-run and assert `guardrailHits.length === 0`.

### R4 — F4 latency

**(a) ~~Prewarm the turn detector.~~ WITHDRAWN — see the correction in [F4](#f4--high-715-second-response-latency-and-a-host-that-cannot-keep-up).**
It would have raised `RuntimeError: no job context found` in `prewarm`, and there was no per-job
model load to remove in the first place. What shipped instead is `build_turn_detection()`, which
guards the construction so a missing model file degrades turn-taking rather than ending a live
interview.

**(b) APPLIED — let the worker hold a provider key directly**, instead of routing every turn through
OpenRouter's proxy hop. Mirrors the backend's existing `VOICE_AGENT_THINK_PROVIDER` /
`VOICE_AGENT_THINK_KEY` escape hatch
([voiceAgentService.js#L280-L297](backend/services/voiceAgentService.js#L280-L297)):

```python
def build_llm():
    # Direct key wins. OpenRouter stays the fallback — it is the thing that works without a
    # per-provider account, and a slower interview beats a dead one (the same trade the backend's
    # thinkProvider makes).
    direct = (os.getenv("AGENT_LLM_API_KEY") or "").strip()
    key = direct or (os.getenv("OPENROUTER_API_KEY") or "").strip()
    if not key:
        logger.warning("no LLM key set — connection test runs without LLM replies")
        return None
    base_url = os.getenv("AGENT_LLM_BASE_URL") or (
        None if direct else os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    )
    return openai_plugin.LLM(
        model=os.getenv("AGENT_LLM_MODEL", "openai/gpt-4o-mini"),
        base_url=base_url,
        api_key=key,
    )
```

Note the model id changes with the provider — `openai/gpt-4o-mini` is OpenRouter's namespacing;
a direct OpenAI key wants `gpt-4o-mini`. Add both to `.env.example`.

**(c) Host.** Move the worker to Linux before judging any of these numbers again. `agent.py start`
also gets `num_idle_processes = 4` for free, which `dev` does not.

**Decisions needed from the owner:** which provider key, and whether the worker moves now or after
the correctness fixes land.

### R5 — F7 audio-quality evidence — APPLIED (first step)

`audioQuality` needs only `wordsPerMinute` and `pauseRatio`
([prosody.js#L58-L74](backend/utils/prosody.js#L58-L74)) — **not** STT confidence. Both are
derivable from events the session already emits, so this does not need an STT wrapper.

In `agent-worker/agent.py`, alongside the F1 buffer:

```python
        self._speaking_since: float | None = None   # monotonic, set on speaking→
        self._speech_ms = 0.0                       # voiced time this answer
        self._turn_since: float | None = None       # first speech of this answer
```

Fed by the documented `user_state_changed` event (verified: `UserStateChangedEvent` carries
`old_state` / `new_state`):

```python
    @session.on("user_state_changed")
    def on_user_state(ev):
        now = time.monotonic()
        if ev.new_state == "speaking":
            agent.note_speech_start(now)
        elif ev.old_state == "speaking":
            agent.note_speech_end(now)
```

and drained in `submit_answer` beside the transcript:

```python
        duration_ms, speech_ms = self._drain_timing()
        if duration_ms:
            evidence["audioDurationMs"] = int(duration_ms)
            words = len(transcript.split())
            evidence["acoustic"] = {
                "wordsPerMinute": round(words / (duration_ms / 60000.0), 1),
                # Silence as a share of the answer's wall clock. Mostly-silence is the signature
                # of a recording that failed, which is the only thing audioQuality acts on.
                "pauseRatio": round(max(0.0, 1.0 - speech_ms / duration_ms), 3),
            }
```

`sanitizeEvidence` already clamps every one of these
([voiceAgentController.js#L161-L191](backend/controllers/voiceAgentController.js#L161-L191)), so no
backend change is needed — the fields are simply not being sent today.

**Second step, needs a prototype.** `transcriptConfidence` requires reaching
`stt.SpeechData.confidence` on `FINAL_TRANSCRIPT` events. `UserInputTranscribedEvent` does **not**
carry it (verified: its fields are `type, transcript, is_final, item_id, speaker_id, language,
created_at`), so it needs a thin wrapper around `deepgram.STT.stream()` that taps
`SpeechEvent.alternatives[0].confidence` before forwarding. The exact `SpeechStream` proxy shape has
not been prototyped — do it as its own change, not bundled with the above. `connection.drops` should
come from LiveKit reconnect events on the same pass.

### R6 — F5 STT — (a) and (b) APPLIED, (c) needs a live run

**(a) Applied:** DTX off on the mic publish
([useLiveKitInterview.js](user/src/portal/useLiveKitInterview.js)).

**(b) Applied — the A/B is now one env change.** `language` was hardcoded in
[`build_stt`](agent-worker/agent.py#L119-L135):

```python
    kwargs = {
        "model": os.getenv("DEEPGRAM_STT_MODEL", "nova-3"),
        "language": os.getenv("DEEPGRAM_STT_LANGUAGE", "en"),
    }
```

Careful: the existing `for param in ("keyterm", "keyterms")` loop catches `TypeError`, but
`_validate_keyterm` raises **`ValueError`** when `keyterm` is sent to a non-nova-3 model — so
switching `DEEPGRAM_STT_MODEL` to `nova-2` will crash the job rather than degrade. Guard it:

```python
    if terms and kwargs["model"].startswith("nova-3"):
        ...keyterm path...
    elif terms:
        # nova-2 and older take weighted `keywords` instead; keyterm prompting is nova-3-only.
        kwargs["keywords"] = [(t, 1.0) for t in terms]
```

**(c) Then measure**, on a healthy host, against a recording of the same speaker:

| arm | model | language | biasing |
|---|---|---|---|
| a | `nova-3` | `en` | `keyterm` — current |
| b | `nova-2` | `en-IN` | `keywords` — accent-matched, weaker biasing |
| c | `nova-3` | `multi` | `keyterm` — keeps biasing, adds code-switching |

Score by word error rate on a hand-corrected reference of ~10 answers. There is no way to pick this
from documentation; (b) is a genuine trade, not an upgrade.

### R7 — F2 candidate utterance record — APPLIED

Largest change, and a deliberate reversal rather than a bug fix — the old behaviour was chosen on
purpose ([voiceAgentController.js](backend/controllers/voiceAgentController.js)), on the grounds
that a second, differently-segmented copy of the candidate's words could disagree with `turns`.

**Why the reversal is right, stated plainly, because the original reasoning was not wrong — it was
incomplete.** The two records *can* disagree, and that disagreement is exactly the information
worth having: it is what turns "the transcript shows one sentence but I spoke for a minute" from a
candidate's word against a database row into something checkable. F1 is the proof — the truncation
was invisible for the whole run precisely because nothing else recorded what was said. Two records
that can disagree beat one record that cannot be audited.

Two deviations from the plan below: a candidate-only flush returns early instead of running an
empty guardrail pass (the guardrail must not even *appear* to scan candidate speech), and the
report exposes one merged, time-ordered `conversationLog` rather than two arrays, since a reviewer
needs the interleaving to see the interview go wrong.

1. `backend/models/InterviewSession.js` — `candidateUtterances`, same shape and cap as
   `agentUtterances` ([#L569](backend/models/InterviewSession.js#L569)).
2. `backend/controllers/voiceAgentController.js` — stop dropping `role !== "assistant"`; route
   candidate rows to the new array. **Do not** run the guardrail over them: it scans for the
   *interviewer* going off-script, and pointing it at the candidate would turn it into surveillance
   of what a candidate is allowed to say.
3. `agent-worker/agent.py` — post user items from the same `conversation_item_added` hook the F1
   buffer already uses, so there is one source and no second segmentation.
4. `backend/controllers/candidateController.js` — add to the report payload beside `guardrailHits`.
5. `admin/src/pages/InterviewReport.jsx` — render as the full conversation, visually distinct from
   the scored transcript, labelled as the audit record.

Non-negotiable constraint: **never read by any scoring path.** Same structural exclusion as
`intents` ([InterviewSession.js#L533-L537](backend/models/InterviewSession.js#L533-L537)) and for
the same reason — how often someone asks for a repeat tracks their accent and their connection, not
their ability. Add a unit test asserting the field is absent from every scoring input.

---

## Appendix — inspecting a stored session

Atlas SRV lookups fail through some local resolvers (`querySrv ECONNREFUSED
_mongodb._tcp.…`) even while a running backend holds a working pool. Forcing a public resolver
works:

```js
require("dotenv").config();
require("dns").setServers(["8.8.8.8", "1.1.1.1"]);   // local resolver refuses _mongodb._tcp SRV
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const doc = await mongoose.connection
    .collection("interviewsessions")
    .findOne({ _id: new mongoose.Types.ObjectId(process.argv[2]) });
  const ai = doc.aiInterview || {};

  for (const u of ai.agentUtterances || []) console.log(`[${u.at.toISOString()}] ${u.text}`);
  for (const t of ai.turns || []) {
    if (t.role !== "candidate") continue;
    console.log(`score=${t.answerScore} text=${JSON.stringify(t.text)}`);
    if (t.agentRendering) console.log(`   agentRendering=${JSON.stringify(t.agentRendering)}`);
  }
  for (const h of ai.guardrailHits || []) console.log(`${h.ruleId} [${h.severity}] ${h.utterance}`);

  await mongoose.disconnect();
})();
```

Run it from `backend/` so `dotenv` and `mongoose` resolve. The room name is `itv-<sessionId>`
([livekitService.js#L55](backend/services/livekitService.js#L55)), so the worker log's
`room=itv-6a7390cb86b0e927652f7bd3` gives the session id directly.

A useful first check on any suspect session: compare `agentUtterances.length` against the number of
candidate turns. On this one it was 22 against 9, which is what F1 and F2 look like from the outside.
