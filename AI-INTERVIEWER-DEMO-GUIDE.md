# AI Interviewer — Demo Runbook

How to drive the AI interviewer end to end in front of a buyer, show every feature that exists,
and never get caught by a silent config gotcha mid-demo.

Companion docs: [CLAUDE.md](CLAUDE.md) (product thesis + the rules the demo is proving),
[STATUS.md](STATUS.md) (what is built), [LIVE-INTERVIEW-DEEP-DIVE.md](LIVE-INTERVIEW-DEEP-DIVE.md)
(the voice layer in depth), [DEPLOY.md](DEPLOY.md) (running it somewhere other than a laptop).

---

## 0. The story you are telling

Say this out loud early — it is the frame that makes every screen below land.

**What everyone else demos.** HireVue / Talview / Micro1 / Apriora put a talking avatar on screen,
let a speech-to-speech model improvise questions, and end with a number the model emitted. The
demo moment is "look, it talks."

**Why that is weak.** Nobody can answer three questions afterwards: *what exactly was asked, why
that number, and what happens when the candidate's lawyer asks.* A speech-to-speech model cannot
tell you what it said or why it stopped. The score is a model's opinion, so it is unreproducible,
unauditable, and indefensible under NYC Local Law 144 or the EU AI Act's Annex III employment
rules.

**What we demo instead.** One system where screening and interviewing are the same loop:
the résumé is decomposed into individually-cited **claims**, the claims the résumé cannot prove
become **interview probes**, the interview tests exactly those, and the report marks each one
verified / contradicted / still unverified — with the résumé quote and the transcript quote side
by side. Every number is computed by **code** over the model's structured output, and the same
inputs reproduce the same score (there is a hash on screen proving it).

The line to use when the avatar question comes up: *"Ours doesn't have a face. It has a receipt."*

---

## 1. Setup (do this the day before, not 10 minutes before)

### 1.1 Start the stack

```bash
# repo root — Mongo + Redis + MinIO (MinIO's S3 API is on :9100; the backend owns :9000)
docker compose up -d

# backend
cd backend
npm install
npm run check:env          # fails loudly on missing/drifted vars — run it, don't skip it
npm run seed:plans         # once, ever
npm run seed:demo          # pre-verified demo accounts, active workspace, no payment wall
npm run dev                # :9000

# admin (recruiter app) — new terminal
cd admin && npm install && npm run dev     # :5173

# user (candidate app) — new terminal
cd user && npm install && npm run dev      # :5174
```

`npm run seed:demo` prints the logins. They are pre-verified, so no email link is needed:

| Who | App | Email | Password |
|---|---|---|---|
| Recruiter | http://localhost:5173 | `admin@demo.test` | `Demo@1234` |
| Candidate | http://localhost:5174 | `candidate@demo.test` | `Demo@1234` |

### 1.2 The five environment variables that decide what your demo can show

Edit `backend/.env`. Each of these changes what appears on screen — none of them fail loudly.

| Var | Set it to | What you lose if you don't |
|---|---|---|
| `OPENROUTER_API_KEY` | a real key | **The whole adaptive interviewer.** Questions come from a fixed bank, the room shows *"running on a standard question set"*, and the report shows an amber **"Fallback engine — placeholder scores"** badge. Honest, and a terrible demo. |
| `DEEPGRAM_API_KEY` | a real key | **Voice.** `/voice/token` 503s, the room silently falls back to typing. Typed interviews still work perfectly — but "spoken interview" is half the wow. |
| `ATS_ENGINE` | `live` | **Claim → Probe → Verdict.** Without it the legacy keyword scorer runs, no ClaimGraph exists, so no probes are generated and the report's Claim Verification card is empty. (Per-tenant alternative below — prefer that.) |
| `BILLING_ENFORCEMENT` | `off` | Only if you have no Razorpay keys — lifts the login paywall and the active-company check so a demo tenant reaches a full workspace. Exact string `off`; anything else keeps the paywall up. |
| `PROBE_ENGINE_ENABLED` | `true` (default) | Probes. Leave it alone unless someone turned it off. |

Then flip the demo tenant onto the evidence engine and integrity clips (safer than the fleet-wide
env var — it only touches Demo Company):

```bash
cd backend
node scripts/_setDemoAtsLive.js          # CompanySettings.ai.atsEngine = "live"
node scripts/_setDemoEvidenceClips.js    # CompanySettings.proctoring.evidenceClips = true
```

**Email is the classic demo-killer.** With `SMTP_HOST` unset, `mailer.js` uses nodemailer's
`jsonTransport`: emails are composed, `EmailLog` says *sent*, the UI says *sent* — and nothing is
delivered. **Do not plan to click a link in an inbox during the demo.** Use the admin's
*Resend interview link* button instead (§3.4) — it returns the live URL on screen with a copy
button.

### 1.3 Build the demo job (do this before the buyer joins)

1. **Jobs → New Job.** Title, description, required skills, ATS threshold `60`.
   - **Interview length: set min `3`, max `4`.** The defaults are 5/8, which is a 12-minute
     interview nobody will sit through on a call. (Fields: *Min / Max interview questions*.)
   - **Assessment policy: `off`.** With `manual` or `auto`, an ATS pass parks at *awaiting your
     decision* instead of minting an interview link, and your demo stalls waiting for a click you
     did not plan.
2. **Job → Scoring Rubric** (`/jobs/:id/rubric`). Read the compiled criteria, fix anything silly,
   then **Approve & Freeze**. *This step is mandatory* — with no approved rubric the evidence
   engine refuses to run and falls back to the legacy scorer (a deliberate human-approval
   boundary), and you lose the probe loop.
3. **Job → Interview questions** (`/jobs/:id/questions`). The server has already compiled a
   must-ask set from the JD + rubric. Read it, then **Approve**. These are delivered *verbatim by
   code* — the model never rewords them.
4. Optional: **Settings → AI** to show model/budget/temperature per tenant.

### 1.4 Get a candidate into the interview queue

The realistic path — do it live in the demo if you have the nerve, or the night before as backup:

```bash
cd backend && node scripts/_makeDemoResumePdf.js
# writes backend/uploads/_demo-resume-rohan-deshpande.pdf (a real PDF, real magic bytes)
```

Then in the candidate app (5174) log in as `candidate@demo.test`, open the job, **Apply**, upload
that PDF. ATS runs synchronously on submit; a pass (≥ threshold) moves the candidate to
`interview_queue`, mints the magic-link session, and queues the invitation email.

Other useful résumés live in `backend/test/fixtures/golden/` (40 hand-labelled cases). The ones
worth knowing:

| File prefix | Use it to show |
|---|---|
| `01-clear_pass-senior-node-backend` | The happy path (this is what `_makeDemoResumePdf.js` renders) |
| `25`–`28 keyword_stuffed-*` | Keyword-stuffing detection — flagged with evidence, **never auto-rejected** |
| `29`–`32 prompt_injected-*` | Prompt injection — neutralised so the injected text is structurally unquotable |
| `33`–`36 vocab_mismatch-*` | Ontology recovery: "k8s" → kubernetes, "JSX" → react, with zero JD tokens on the page |
| `17`–`24 borderline-*` | Ambiguity routed to a human instead of a confident guess |

**Always have one candidate already sitting at a completed interview with a full report.** If the
live run wobbles, you pivot to that report and the demo continues.

---

## 2. Pre-flight (10 minutes before, every time)

- [ ] All three dev servers up: `:9000`, `:5173`, `:5174`. **Vite must be on 5173/5174 exactly** —
      if a stale process pushed it to 5175, CORS rejects every request and the app looks dead.
- [ ] `GET http://localhost:9000/api/ready` returns `{mongo:true, redis:true}`.
- [ ] Logged into admin (5173) in one browser profile, candidate (5174) in a **second profile or
      window** — the two apps use different auth stores, but you want them side by side anyway.
- [ ] Job has an **approved rubric** and an **approved question set** (green/frozen badges).
- [ ] One candidate in **AI Interviews** queue, one candidate with a **completed report**.
- [ ] Camera + mic permissions already granted for `localhost:5174` in the demo browser
      (do the grant once beforehand — a permission prompt on stage is dead air).
- [ ] Headphones in. This matters: the pre-check *measures* whether your mic hears your speakers.
      Headphones ⇒ `isolated` ⇒ **barge-in is enabled** and you can cut in mid-question, which is
      the single most impressive live moment. Laptop speakers ⇒ `bleeding` ⇒ turn-based only.
- [ ] Quiet room. The interviewer is genuinely patient about silence, and the demo is better when
      that reads as designed rather than as a hang.
- [ ] Screen-share the *candidate* window; keep the admin window ready to switch to.

---

## 3. The demo script

Roughly 18–22 minutes. Times assume a 3–4 question interview.

### Act 1 — "The résumé is not a document, it's a set of claims" (3 min)

**Where:** admin → **Candidates** → your candidate.

1. Open the candidate. Point at the **hostility panel** if you used a hostile fixture — amber/red,
   with the offending text quoted. Say: *"We detected keyword stuffing. Notice what did not
   happen: no score changed and nobody was auto-rejected. Detection flags; humans decide."*
2. Click **Why this score** (`/candidates/:id/score`). This is the money screen for a technical
   buyer:
   - per-criterion breakdown with **points, weight, status, and the verbatim résumé quote**
   - knock-out gates named explicitly
   - the **open questions** panel — contradictions + unverified high-weight claims
   - the **reproducibility hash** at the bottom

   Say: *"The model never emitted this number. It extracted claims with citations; JavaScript did
   the arithmetic. Same inputs, same hash, same score — that's what makes it defensible."*
3. Point at the unverified high-weight claims. *"These are the things the résumé asserts but
   cannot prove. Watch what happens to them next."*

### Act 2 — "The interview is a test plan, not a chat" (2 min)

**Where:** admin → **AI Interviews** (queue) → candidate → **AI Interview** section.

1. Show the queue: candidates who cleared ATS, with scores.
2. On the candidate page, scroll to **AI Interview**. Click **Resend interview link**.
   The new URL appears on screen with a **copy** button (and is emailed, but you are not relying
   on that). Copy it.
3. Mention the guardrails while you paste: the link rotates on every resend; a completed interview
   can't be resent; an in-progress one can't be cut off.

### Act 3 — The interview itself (8–10 min)

**Where:** candidate window — paste the link.

**3a. Pre-interview checks** (`/portal/pre-check`) — 90 seconds, and every card is a talking point:

| Card | What to say |
|---|---|
| Camera / Microphone | Standard. |
| **Sound (recommended)** | *"It plays a tone and measures whether the mic hears the speakers. That measurement — server-side, not client-claimed — decides whether you're allowed to interrupt the interviewer."* Click **Play test tone → Yes, I heard it**. With headphones you'll see *"well isolated, so you can interrupt."* |
| Fullscreen | Recommended, never required — it doesn't exist on iOS Safari, and requiring it locks out every mobile candidate. |
| Internet speed | Real 2 MB download against the API. |
| **Identity verification** | Capture the photo. The face descriptor is computed **in the browser** and matched live during the interview — raw video never leaves the device. |
| **Phone as second camera** (if enabled) | QR → phone pairs with a single-purpose 10-minute token, sends **presence + integrity events only, never video**. |
| Consent boxes | Read the monitoring consent aloud. If evidence clips are on, show the second, *optional* box: ≤15s clips, max 6, only on a serious flag, declining changes nothing. |

**3b. Voice consent** — the room asks before the mic ever opens. Point at it:
*"The server refuses to mint a streaming token until this is recorded. Decline and you type
instead — evaluated identically, never penalised."* Click **Agree & start voice interview**.

**3c. The opening.** The interviewer greets the candidate **by name**, gives its own name, says
how many questions and roughly how long, tells them there's no rush, and says they can ask for a
repeat. Then it asks for a short self-introduction.

Say: *"That greeting is authored in code, not generated. Every candidate for this role hears the
same one. And the introduction is deliberately not scored — there's no rubric criterion behind
'tell me about yourself', so a number attached to it would be a judgement with nothing to justify
it. The counter says 'Introduction', not 'Question 0 of 4'."*

**3d. The live moments — trigger these deliberately.** This is the part to rehearse.

| Say this out loud | What happens | The line |
|---|---|---|
| Just stop talking mid-answer for ~7 seconds | *"Take your time — I'm here."* and it waits much longer | *"Silence is handled as a conversation, not a deadline. Those words come from a fixed, human-approved bank — checked at boot for evaluative language, so it can never say 'good answer' to one candidate and nothing to the next."* |
| **"Sorry, could you repeat that?"** | The **same** question, the **same audio bytes**, after *"Of course — here it is again."* | *"Never regenerated — a reworded repeat is a different test. The repeat count is recorded and structurally excluded from every score: it tracks accent and connection quality, not ability."* |
| **"I don't know."** (say only that) | *"That's no problem — let's move on."* and it moves on | *"Recorded as **declined**, not scored zero. It's excluded from the mean **and counted**, and that count travels with the score everywhere — so nobody's average is flattered by the questions they skipped."* |
| **"Give me a second."** | *"Of course — take the time you need."* and the silence clock stops | *"Costs the candidate nothing to ask."* |
| Talk over the question (headphones only) | It stops mid-sentence and listens | *"Barge-in, but only on a device where we measured it's safe. And a question you talked over is not counted as asked — the probe goes back in the queue, so the interview can't end early on a half-heard question."* |
| **"That's my answer."** at the end of a real answer | Turn ends immediately | *"Only honoured as the tail of a substantive answer — on its own it's usually a sentence still forming."* |
| **"I want to stop."** (optional, powerful) | *"Just to confirm — would you like to end the interview here? Say yes to finish now, or just carry on and we'll keep going."* Say nothing → it carries on | *"The one irreversible action is never taken on a single utterance, and silence always means carry on. This is thirty lines of code with a stored trigger phrase — not a model deciding when to be understanding."* |

Also worth pointing at while it runs:
- the **self-view PiP** with the *Monitored* badge — and the **hide** control, because a candidate
  distracted by their own face otherwise has no recourse
- the **live transcript shows questions only** in voice mode: *"Watching your own words appear
  turns a conversation into a dictation exercise. The full verbatim transcript is on the session
  and in the recruiter's report."*
- **Switch to typing** is always one tap away and changes nothing about how the answer is scored
- a probe question landing: *"That question exists because the résumé claimed something it
  couldn't prove."*

**3e. Finish.** Answer the last question. The interviewer delivers an authored closing and the
room shows **Interview Complete**. Evaluation runs *off* the request path, so the candidate's
submit returns instantly.

Say: *"When the interview ends is decided by code — every probe covered, every approved question
asked, minimum length reached. The model can propose closing; it cannot close over an uncovered
question."*

### Act 4 — The report (5 min, the close)

**Where:** admin → candidate → **Interview Report** (`/candidates/:id/interview-report`).
Give it a few seconds — finalisation is detached.

Walk it top to bottom, in this order (the page is deliberately ordered by what a recruiter must
not miss):

1. **Degraded-session banner**, if it fires — *"On a broken audio signal, an unanswered question
   can't be told apart from an unheard one, so the recommendation is withheld rather than printed
   over a broken signal."*
2. **Verdict banner** — the headline call with confidence and a one-line reason.
3. **"What we actually know"** (coverage matrix) — every rubric requirement grouped into
   **Proven / Failed / Too little evidence**, weighted by the rubric. Land this hard:
   *"The third group is not a mark against the candidate. It's a statement about **our** test — and
   it doubles as the question list for your next round. No other product will tell you what it
   failed to measure."*
4. **Evaluation** — overall + communication / technical / problem-solving. If something wasn't
   measured it says *not measured* rather than showing three identical fake numbers.
5. **Answer-by-answer quality strip** — one bar per answer, flagged bars for degraded audio.
   *"Eight near-silent answers in a row are visible at a glance instead of averaged away."*
6. **Claim verification** — the payoff. Each probed claim with **the résumé quote and the
   transcript quote side by side**, the verdict, and the **pre → post score delta**.
   *"The score moved because a claim was proven or wasn't. That's the loop closing. And a
   contradicted claim never auto-rejects — both quotes are here so you read the exchange
   yourself."*
7. **Skills assessment** card, if one ran (or a *recorded human decision* if a recruiter skipped
   it — a skip renders as a decision with a name and a time, never as missing data).
8. **Integrity & Proctoring** — risk band, identity match, per-type breakdown. Point at the rows
   marked **Not scored**: *"Those record our camera view quality, not the candidate's conduct."*
   Play an evidence clip if you have one — *"every view writes an audit-log row, and the
   measurement that triggered it is printed above the video so you can overturn the flag."*
9. **Decision** buttons + note → recorded on the timeline with your name.
10. **Transcript** — per-answer score, delivery, word count, duration, responsive/non-responsive.
11. **Download PDF** — hand it over. Everything above, in one artefact.

### Act 5 — "Now show me the receipts" (2 min, for the sceptic)

- **Reports → Bias Audit Pack** (one click, JSON download): bias-controls statement, rubric
  versions + weights + approver names, decisions by band, criterion pass rates, live
  counterfactual results, review + override rates, per-assessment reproducibility hashes.
  *"This is the Local Law 144-shaped artefact, as a download, generated from what actually
  happened."*
- **Reports → Source quality** — per-source pass rate, **claim-verification rate**, advance rate,
  hires. *"Source quality measured by downstream truth. A click-counting competitor cannot produce
  this number."*
- **Review Queue** — where ambiguity goes. *"Disagreement is a routing signal, not noise. It never
  gets averaged into a falsely confident number."*
- If you have superadmin: **/platform** → **AI trust dashboard** — live breaker state, QA-gate
  outcomes, ensemble agreement, counterfactual bias-probe results (leaks are reported as
  *incidents*, not statistics), spend by kind.

---

## 4. Feature checklist — everything you can show

Tick these off if you want full coverage.

**Recruiter-side setup**
- [ ] Versioned **RoleRubric**, approve & freeze, no numeric input anywhere (importance tiers only)
- [ ] JD quality flags with verbatim quotes (elite-university proxy, "native speaker", etc.)
- [ ] **Must-ask question set** — compiled, vetted (unlawful/accusatory/duplicate detection),
      approved, delivered verbatim by code
- [ ] Per-job interview length (min/max questions)
- [ ] Interviewer **persona** — name, voice, patience only. Never questions. Tenant-approved and
      versioned; every session is stamped with which persona ran and whether it was the deployment
      default (`POST /api/personas` + `/:id/approve`; no dedicated admin screen yet — call the API
      or show the stamp on the report)

**Candidate-side interview**
- [ ] Pre-check: camera, mic, **sound/echo measurement → barge-in eligibility**, fullscreen,
      device compat, speed test, identity photo, phone-cam QR
- [ ] Consent: proctoring, optional evidence clips, **voice consent before the mic opens**
- [ ] Authored greeting by name + unscored warm-up introduction
- [ ] Adaptive follow-ups, claim probes, verbatim approved questions
- [ ] Backchannels: reassure / acknowledge / confirm / decline / pause replies
- [ ] Repeat on request (same audio, count excluded from scoring)
- [ ] Decline, pause, and confirmed withdrawal
- [ ] Semantic endpointing ("has this person finished?" from sentence shape, not a flat timer)
- [ ] Barge-in with probe re-queue
- [ ] Switch to typing at any point; typed draft survives a refresh; failed sends show **Retry**
- [ ] Live proctoring: tab switch, blur, fullscreen exit, face presence, multi-face, identity match
- [ ] Event-anchored evidence clips (never continuous recording)

**Report + governance**
- [ ] Coverage matrix (proven / failed / too little evidence)
- [ ] Claim verification with both quotes + score delta
- [ ] Turn-quality strip, degraded-session banner, withheld recommendation
- [ ] Integrity card with unscored rows called out
- [ ] Assessment section (or the recorded skip decision)
- [ ] PDF export
- [ ] Bias audit pack, source quality, review queue, calibration ("candidates scoring X–Y here
      advanced Z% of the time" — only shown once there are ≥30 outcomes; below that it shows
      nothing rather than a fake-precise percentage)

---

## 5. When it goes wrong (it will, once)

| Symptom | Cause | Fix, live |
|---|---|---|
| Everything 401s / nothing loads | Vite grabbed 5175 because 5173/5174 were held; CORS rejects it | Kill the stale process, restart Vite on the right port. Check the terminal banner. |
| *"running on a standard question set"* banner | No `OPENROUTER_API_KEY`, no consent, or tenant over LLM budget | Own it: *"this is the honest-degradation path — it labels itself everywhere, screen and PDF."* Then switch to the pre-baked completed report. |
| Voice never starts; it flips to typing | No `DEEPGRAM_API_KEY`, or mic permission denied | Do the typed interview — it's the same engine. Say voice is a delivery layer over the same instrument. |
| Claim Verification card is empty | Legacy ATS ran: no approved rubric, or `atsEngine` ≠ live | Nothing to fix mid-demo. Use the pre-baked candidate. Prevent it: run `_setDemoAtsLive.js` and approve the rubric. |
| Candidate is stuck at *ATS passed*, no link | Job's `assessmentPolicy` is `manual`/`auto` | On the candidate page click **Skip to AI interview** (recorded as your decision) — or **Send assessment** if you want to demo that leg. |
| Interview link "expired" | `INTERVIEW_LINK_VALIDITY_HOURS` (48h default) elapsed | **Resend interview link** on the candidate page. Rotates the token, shows the new URL on screen. |
| Interviewer talks over itself / stops mid-question | Speakers, not headphones — mic hears the output | Put headphones on. Or re-run the sound check and accept turn-based mode. |
| No email arrived | `SMTP_HOST` unset → jsonTransport, logged not sent | Never depend on email in a demo. Use the resend button. The body is in the backend console if you need it. |
| Nothing after the last answer | Finalisation is detached and takes a few seconds | Wait, then reload the report. Fill with Act 5 material. |
| Quota 429 | Plan limits binding | `BILLING_ENFORCEMENT=off` + `DEMO_PLAN_KEY=enterprise`, restart backend. |

**The universal recovery:** switch to the pre-baked completed report and keep talking. The report
is where the differentiation actually lives — the live interview is the theatre around it.

---

## 6. Objection handling

| They say | You say |
|---|---|
| *"Everyone has an AI interviewer now."* | *"Everyone has a model that talks. Show me one that can tell you which résumé claim each question was testing, and what the transcript proved. That's this."* |
| *"How do I know it isn't biased?"* | Bias audit pack + the counterfactual probe: names, pronouns, graduation years and university brands are stripped before the model ever sees the résumé, and we assert byte-identical model input across variants. It caught a real name/date collision — "May Chen" vs "May 2022" — and a bug in its own first implementation. |
| *"Can it reject people automatically?"* | Auto-reject is opt-in and default-off, the deterministic fallback can never emit an adverse recommendation, a contradicted claim never auto-rejects, and the review band never auto-rejects. Every automated adverse action needs a human. |
| *"What if the model hallucinates?"* | Structurally impossible to reach a score: every extracted fact must carry a verbatim character span that code verifies is a literal substring of the source. An uncitable claim is dropped, not trusted — and the drop count is telemetry we keep. |
| *"Candidates will game it."* | Résumés are treated as adversarial input. Prompt injection is neutralised so the injected text is unquotable, keyword stuffing is detected against a calibrated ontology, invisible and tiny-font text is caught — and all of it **flags** rather than decides. |
| *"What about accents / bad audio?"* | Delivery and confidence are labelled *secondary signal quality, not competency*, with a note that they can reflect accent or audio rather than skill. Repeat requests are excluded from scoring for exactly the same reason. |
| *"Show me it's reproducible."* | Point at the reproducibility hash on "Why this score", rerun the assessment, show the identical hash and identical decomposition. |

---

## 7. Quick reference

**URLs**

| Screen | Path |
|---|---|
| Recruiter app | http://localhost:5173 |
| Rubric editor | `/jobs/:id/rubric` |
| Question set | `/jobs/:id/questions` |
| Assessment paper / tracker | `/jobs/:id/assessment` · `/jobs/:id/assessments` |
| Candidate | `/candidates/:id` |
| Why this score | `/candidates/:id/score` |
| Interview report | `/candidates/:id/interview-report` |
| AI interview queue | `/ai-interviews` |
| Review queue · Reports | `/review-queue` · `/reports` |
| Platform console (superadmin) | `/platform` |
| Candidate app | http://localhost:5174 |
| Interview magic link | `/interview/:token` → `/portal/dashboard` |
| Pre-check · Interview room | `/portal/pre-check` · `/portal/interview` |

**Phrases that trigger interviewer behaviour** (say them as the whole utterance — the detector
only fires when the phrase is essentially all you said):

- Repeat: *"could you repeat that"* · *"sorry, what was the question"* · *"I didn't catch that"*
- Decline: *"I don't know"* · *"can we skip this"* · *"I've never used that"*
- Pause: *"give me a second"* · *"let me think about that"* · *"bear with me"*
- Finish turn: *"that's my answer"* · *"that's all from me"* · *"next question"* (only after a real answer)
- Withdraw: *"I want to stop"* · *"can we end this"* → then say nothing, and it carries on

**Timing knobs** (`backend/.env`, if the pauses feel wrong on the day):
`VOICE_INITIAL_SILENCE_MS` (6000) · `VOICE_POST_REASSURANCE_GRACE_MS` (9000) ·
`VOICE_CONFIRM_GRACE_MS` (5000) · `DEEPGRAM_UTTERANCE_END_MS` (3200) ·
`VOICE_MAX_REASSURANCES` (2) · `VOICE_MAX_REPEATS_PER_QUESTION` (3).
Restart the backend after changing any of them.
