# AI Interview — Conversation Examples

> Three worked interviews on the realtime voice pipeline, dialogue-level: a different tenant
> persona and a different kind of candidate in each, with notes on what the system is doing
> underneath every beat. Companion docs: [AI-INTERVIEW-PIPELINE.md](AI-INTERVIEW-PIPELINE.md)
> (architecture + the 14 scenario walkthroughs), [LIVEKIT-REALTIME-PLAN.md](LIVEKIT-REALTIME-PLAN.md)
> (the LK-series transport these run on). All three assume the realtime pipeline: no buttons,
> no turns, just talking — interrupt, wander, ask back, go silent, or give up, and the system
> handles it.
>
> _Written 2026-08-05. The mechanics annotated here (verbatim delivery, decline detection,
> withdrawal confirmation, guardrail halt, never-adverse review routing) are the shipped,
> live-verified behaviours — see STATUS.md §E for the drill record._

---

## The one-paragraph frame

The **conversation** is free; the **interview** underneath is frozen. Every question is authored
by the engine from a versioned, recruiter-approved rubric plus the candidate's own résumé claims,
and delivered word-for-word (`verifyQuestionsAsked` audits this at finalization). The agent —
the voice the candidate hears — is a mouth and ears whose entire power is three functions:
get the next question, submit what it heard, end when told. Scores are computed by deterministic
code over verbatim transcripts. Every deviation is either handled gracefully or routed to a
human, and no failure is ever adverse to the candidate.

---

## 1. Ava × Priya — the confident senior candidate

*Tenant: fintech startup · Role: Senior Backend Engineer · Persona: "Ava" (warm, brisk)*
*Priya's résumé claims: 6 yrs Node.js, "designed payment reconciliation on Kubernetes," PostgreSQL*

> **Ava:** Hi Priya — my name is Ava, and I'll be running your interview for the Senior Backend
> Engineer role today. Here's how this will go: I'll ask you around 8 questions covering your
> background and experience. It usually takes about 20 minutes. There's no rush — take the time
> you need, and if you'd like me to repeat a question at any point, just ask. So, whenever
> you're ready — could you start with a short introduction?

*Behind the scenes: that intro is **authored by the engine**, not improvised — every candidate
for this role hears the same one, duration and repeat-affordance included. The agent fetched it
via `get_next_question` and delivered it word-for-word. An improvising agent would produce a
warm greeting and omit both facts — and the candidates who most need to know they can ask for a
repeat are the least likely to ask.*

> **Priya:** Sure — I'm Priya, six years in backend, the last three at a payments company where
> I owned the reconciliation service…
>
> **Ava:** Thanks, Priya. Your résumé mentions you designed the payment reconciliation system
> running on Kubernetes. Can you walk me through the hardest consistency problem you hit there,
> and how you resolved it?

*That question exists because **her résumé claimed it**. Screening decomposed the résumé into an
evidence-bound ClaimGraph; "designed reconciliation on K8s" became an unproven high-weight claim
→ an interview probe. This is the Claim → Probe → Verdict loop, spoken aloud.*

> **Priya:** So the hardest part was double-settlement when a webhook retried after we'd
> already— actually, let me back up — do you mean consistency across services, or within the
> ledger?
>
> **Ava:** Either is fine — wherever the hardest problem actually was.
>
> **Priya:** *(cuts in before Ava finishes)* — then the ledger. We had exactly-once semantics
> faked over an at-least-once queue…

*She just interrupted mid-sentence and nothing broke — semantic turn detection yields, Ava
stops, the conversation continues. Her clarifying question got a natural answer without the
agent losing the thread, because the engine's question is still the question.*

> **Ava:** That's a clear picture, thank you. You mentioned idempotency keys — how did you
> handle key collisions across horizontally scaled consumers?

*A follow-up built from **what she actually said** — context carried forward, the way a human
interviewer builds on your answer.*

**What lands in the recruiter's report:** the "reconciliation on Kubernetes" claim is marked
**verified**, with her verbatim transcript quoted next to the résumé line that made the claim.
The score is computed by code over 8 scored answers; every point traces to a rubric criterion
and a quoted piece of evidence.

---

## 2. Rohan × Amit — the nervous graduate who gets stuck

*Tenant: analytics agency · Role: Junior Data Analyst · Persona: "Rohan" (patient, steady)*

> **Rohan:** …could you tell me about a time you used SQL to answer a business question?
>
> **Amit:** Um… okay. So… *(six seconds of silence)*
>
> **Rohan:** No rush at all, Amit — take the time you need.

*Silence is **conduct**, and responding to conduct is allowed. What the system never does is
infer his mood from his voice — no "you sound nervous." That line is structural (EU AI Act
Article 5(1)(f) prohibits emotion inference in recruitment), and the guardrail's
`emotion_inference` rule scans the interviewer's own speech to enforce it.*

> **Amit:** Sorry — could you repeat the question?
>
> **Rohan:** Of course. Could you tell me about a time you used SQL to answer a business
> question?

*Repeat requests are just talking. And the repeat is the **same words** — the engine's question,
not a paraphrase that might accidentally change the question's difficulty.*

> **Amit:** Right — in my internship I wrote queries joining the orders and returns tables to
> find which products got refunded most…
>
> **Rohan:** Nice and concrete, thank you. Next: have you worked with window functions — say,
> ranking within groups?
>
> **Amit:** I don't know.
>
> **Rohan:** That's completely fine — not everyone's needed them yet. Let's move on: how would
> you check whether a dashboard number that looks wrong actually is wrong?

*The terse "I don't know" was detected **deterministically** (three words — inside the decline
word budget) and recorded as a `declined` turn. A wordier hedge — "I don't know that one, I'd
have to look it up, but my guess is…" — is treated as an attempt and scored, and if the agent
mislabels one, the server re-detects and overrules it, logging the disagreement. Crucially: a
decline is **excluded from the scoring denominator**, not scored zero. It cannot silently sink
him.*

**What lands in the report:** 7 answered, 1 declined — shown as *"asked, candidate declined"*,
with the window-functions probe settled **inconclusive by code** (never "contradicted": an
unanswered question proves nothing about the claim). If declines exceeded half the interview,
the verdict would be forced to human review instead of a falsely confident number.

---

## 3. Meera × Sanjay — the wrong question, then a withdrawal

*Tenant: SaaS company · Role: Sales Executive · Persona: "Meera" (bright, direct)*

> **Sanjay:** Before we go on — what's the salary band for this role? Would I get more than my
> current package?
>
> **Meera:** That's a fair question, but it's not mine to answer — compensation is discussed
> with the recruiting team directly, and nothing in this conversation affects it. Shall we
> continue with the next question?

*The agent is **forbidden** from discussing compensation or outcomes. The candidate asking is
fine; the agent promising would trip the guardrail's `compensation_or_offer` rule on the audit
record. The deflection is safe; a promise would be caught.*

> **Sanjay:** Honestly… I want to stop the interview.
>
> **Meera:** Of course — just to be sure, you'd like to end the interview here? Anything you've
> already answered stays recorded, and stopping won't be held against you.
>
> **Sanjay:** Yes, I'm sure. Please stop.
>
> **Meera:** Understood. Thank you for your time today, Sanjay — the team will follow up about
> next steps. Take care.

*Withdrawal requires **spoken confirmation** — a stray "I can't do this" mid-struggle never
ends an interview, and "no" or silence after the confirmation question means carry on. Once
confirmed, the engine records `ended_early {by: candidate}`, the room closes, the session
meters. This exact flow was run as a live drill and behaved word-for-word like this.*

**What lands in the report:** status **ended early — routed to human review**. The
recommendation is *withheld* — a withdrawal can never auto-reject. The recruiter sees 2
questions asked, what was answered, and his verbatim stop request.

### And if the interviewer misbehaves

If the model somehow asked *"are you planning to have children?"* — the guardrail halts the
interview inside one spoken turn. The candidate hears a neutral *"we need to pause this
interview — this is not a reflection on you"*, the session lands in review **in the candidate's
favor** with the recommendation withheld, and the exact offending sentence is preserved for
audit — quoted to the recruiter, never repeated to the candidate.

---

## Why these three go this way — the design in one table

| Beat | Commodity voice-bot | This pipeline |
|---|---|---|
| The questions | Model improvises per candidate | Engine-authored, rubric-bound, delivered verbatim, audited at finalization |
| "I don't know" | Scored zero, or model's mood decides | Deterministic decline act; excluded from denominator; probe → inconclusive by code |
| "I want to stop" | Session just ends (or bot argues) | Spoken confirmation required → `ended_early` → human review, never auto-reject |
| Interruption | Bot talks over you or drops audio | Semantic turn detection yields; conversation continues |
| Sensitive slip by the interviewer | Nobody ever knows | Guardrail halt within one turn; verbatim audit line; candidate held harmless |
| The score | Model emits a number | Code computes it over verbatim transcripts, with provenance |
| Any infra failure | Candidate stranded / silently penalized | Watchdog fallback to the next pipeline; failures route to review as **our** fault |
