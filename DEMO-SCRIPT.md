# Live Demo Script — AI Interviewer

The talk track. Where you are, what you click, what you say, and the line that carries them to the
next screen. ~18 minutes.

For setup, config and what-to-do-when-it-breaks, see
[AI-INTERVIEWER-DEMO-GUIDE.md](AI-INTERVIEWER-DEMO-GUIDE.md). This file is what you read on stage.

---

## The shape of the demo

```
1. Open          (1 min)   — the one idea
2. The job       (2 min)   — what the AI is allowed to ask
3. The candidate (3 min)   — the résumé becomes claims
4. The interview (7 min)   — the claims get tested, live
5. The report    (4 min)   — the loop closes
6. Close         (1 min)   — the receipts
```

**One sentence to keep coming back to:** *"Screening and interviewing aren't two products here.
The screen produces the questions; the interview answers them."*

---

## 1. Open — 1 minute

**Screen:** nothing. Just talk.

> "Before I show you anything — every AI interviewer on the market right now is a model that
> talks. You put an avatar on screen, it improvises questions, and at the end it emits a number.
>
> The problem is what happens next. You can't say what exactly it asked, you can't say why the
> number is what it is, and you can't defend it when a rejected candidate's lawyer asks.
>
> What I'm going to show you is one loop instead. The résumé gets broken into claims. The claims
> it can't prove become the interview questions. The interview tests exactly those. And the report
> tells you which ones held up — with both quotes side by side.
>
> Ours doesn't have a face. It has a receipt. Let me show you."

**Bridge:** *"It starts with the job, because that's where we decide what the AI is even allowed to ask."*

---

## 2. The job — 2 minutes

### Screen: **Jobs → [your job] → Scoring Rubric**

**Do:** open the rubric. Scroll the criteria list once, slowly.

> "This is the job description compiled into explicit criteria — must-haves, nice-to-haves,
> disqualifiers. A recruiter reads it, edits it, and approves it. Then it's frozen.
>
> Two things to notice. There's no box anywhere on this screen to type a number into — you pick
> how important something is in words, and the maths is derived. And once it's frozen, every
> candidate for this role is scored against this exact version. That's what makes comparing two
> candidates legitimate."

**Do:** point at the quality flags panel (if present).

> "It also read your job description back to you. It flags things like 'elite university
> preferred' or 'native speaker' — with your own wording quoted — because those are the phrases
> that create legal exposure."

### Screen: **Jobs → [your job] → Interview questions**

**Do:** show the approved set.

> "And these are the questions you've approved for this role. They get read to every candidate
> word for word — the AI never rewords them. When someone asks 'who decided what was asked', the
> answer has a name and a timestamp on it."

**Bridge:** *"So that's the fixed part. Now let's put a real candidate through it."*

---

## 3. The candidate — 3 minutes

### Screen: **Candidates → [candidate]**

**Do:** open the candidate.

> "This person applied, uploaded their CV, and was screened automatically."

**Do:** if there's a hostility flag, point at it.

> "We flagged keyword stuffing in this CV — and here's the text. Notice what didn't happen: no
> score changed and nobody got auto-rejected. We detect; you decide."

### Screen: **Why this score**

**Do:** click **Why this score**. Scroll slowly through the criteria breakdown.

> "This is the bit nobody else can show you.
>
> Every requirement, what the candidate scored on it, and **the exact line from their CV** that
> earned it. Not a similarity percentage — the actual sentence.
>
> And the model didn't produce this number. The model read the document and pulled out claims with
> citations. The arithmetic is code. Same CV in, same score out, every time."

**Do:** scroll to the **open questions** panel.

> "Now this is the important part. These are the things the CV *claims* but can't *prove*.
> They've asserted five years of Kubernetes; nothing on the page evidences it.
>
> Most products would either believe it or penalise it. We do neither — we turn it into a
> question."

**Bridge:** *"So let's watch it get asked."*

---

## 4. The interview — 7 minutes

### Screen: **candidate window** — paste the interview link

**Do:** open the link. Land on the pre-check page.

> "This is what the candidate sees. Camera, mic, connection, and a photo for identity.
>
> One thing worth watching —"

**Do:** click **Play test tone → Yes, I heard it**.

> "— it plays a tone and measures whether your microphone can hear your own speakers. That decides
> whether you're allowed to interrupt the interviewer mid-question. It's measured, not assumed."

**Do:** point at the consent boxes, don't read them fully.

> "Consent is explicit, and the camera analysis runs *in the browser* — the raw video never
> reaches us. Only the integrity signals do."

**Do:** click through. On the voice consent screen:

> "And it asks before the microphone ever opens. Decline and you type instead — evaluated
> identically."

**Do:** start the interview. Let the greeting play in full.

> "It greets them by name, introduces itself, says how many questions and roughly how long, and
> tells them they can ask for a repeat. That's written once and every candidate hears the same
> one.
>
> And it opens by asking them to introduce themselves — which is deliberately *not* scored. There's
> no criterion behind 'tell me about yourself', so there's nothing to justify a number. Look at
> the counter: it says Introduction, not Question 0."

**Do:** answer normally. Then run these three moments — pause between each so they land.

**Moment 1 — go quiet mid-answer for ~7 seconds.**

> "Take your time — I'm here. It waits. Silence is a conversation here, not a deadline.
> And those words come from a fixed approved list, so it can never tell one candidate 'great
> answer' and the next one nothing."

**Moment 2 — say: "Sorry, could you repeat that?"**

> "Same question, same words, same audio. Never regenerated — a reworded question is a different
> test. And how many times you asked for a repeat is recorded and deliberately kept out of the
> score, because that tracks your accent and your wifi, not your ability."

**Moment 3 — say only: "I don't know."**

> "Watch — no dwelling, it just moves on. And that goes down as *declined*, not zero. It's kept
> out of the average **and** counted, so nobody's score gets flattered by the questions they
> skipped."

**Do:** when a probe question comes up, flag it.

> "That question exists because their CV claimed something it couldn't back up. This is the screen
> and the interview being the same system."

**Do:** finish the last answer. Let the closing play.

> "And when it ends is decided by code — every question covered, minimum length reached. The model
> can suggest wrapping up; it can't wrap up over a question it never asked."

**Bridge:** *"That took four questions. Here's what your recruiter gets."*

---

## 5. The report — 4 minutes

### Screen: **admin → candidate → Interview Report**

Work top to bottom. Don't jump around — the page is ordered by what matters most.

**Do:** point at the **verdict banner**.

> "The headline call, with a reason. Not just a number."

**Do:** scroll to **"What we actually know"**.

> "This is the screen recruiters actually use. Every requirement for the role, sorted into three
> buckets: proven, failed, and *too little evidence*.
>
> That third one is the one I'd buy this for. It's not a mark against the candidate — it's us
> telling you what our own test failed to measure. And it doubles as the question list for your
> next round. No other product will admit what it didn't find out."

**Do:** scroll to **Claim verification**.

> "And here's the loop closing.
>
> Left: what the CV said. Right: what they actually said in the interview. And the verdict —
> verified, contradicted, or inconclusive.
>
> See that? The score moved, because a claim got proven. And a contradicted claim never
> auto-rejects — both quotes are right here so you can read the exchange and make the call
> yourself."

**Do:** scroll to **Integrity**.

> "Integrity signals — identity match, tab switching, whether a second face appeared. Advisory
> only. And notice these rows marked 'not scored' — those record *our* camera quality, not their
> behaviour."

**Do:** scroll to the **transcript**, then click **Download PDF**.

> "Full transcript, scored answer by answer. And the whole thing exports as a PDF you can put in
> front of a hiring manager who has never logged into this system."

**Bridge:** *"Last thing, and it's the one your legal team will care about."*

---

## 6. Close — 1 minute

### Screen: **Reports**

**Do:** click **Bias Audit Pack**. Let the file download.

> "One click. Every rubric version, who approved it, decisions by band, the bias checks we ran and
> what they found. Generated from what actually happened, not written by a consultant.
>
> That's the difference. Everyone else can show you an AI that interviews. This is the one that
> can still explain itself six months later."

**Do:** stop talking. Ask: *"Where would you want to start — one role, or a whole funnel?"*

---

## If you only get 5 minutes

Skip everything except these three screens:

1. **Why this score** → *"every number traces to a quoted line in the CV, and code did the maths"*
2. **Claim verification** on the report → *"CV quote, interview quote, verdict — the loop closing"*
3. **Bias Audit Pack** → *"and it can explain itself to a regulator"*

---

## Cue card — phrases to say into the mic

| Say | It does |
|---|---|
| *"Could you repeat that?"* | Repeats the question, same audio |
| *"I don't know."* | Acknowledges, moves on, records it as declined |
| *"Give me a second."* | Stops the clock, says take your time |
| *"That's my answer."* | Ends your turn immediately |
| *(silence, ~7s)* | "Take your time — I'm here" |

## Don'ts

- Don't read the consent text aloud. Point at it, say "consent is explicit", move on.
- Don't open Settings, the rubric editor's internals, or the platform console unless asked.
- Don't explain how the scoring maths works. Say "code does the maths, not the model" and move on.
- Don't apologise for a pause — the waiting is a feature, and narrating it as a bug reframes it.
- Don't demo the assessment paper in the same session. It's a separate product surface and it
  doubles the runtime.
