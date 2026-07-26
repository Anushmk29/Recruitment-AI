---
target: user/src/pages/InterviewRoom.jsx
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-07-25T00-46-05Z
slug: user-src-pages-interviewroom-jsx
---
Method: dual-agent (A: aa122bde28b826008 · B: a66f3637fc118daf2)

**Target:** `user/src/pages/InterviewRoom.jsx` — the live AI interview screen · **Mode:** Operate

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The voice phase machine is genuinely good, but `voice.error` is written (`useVoiceInterview.js:228`) and never destructured (`InterviewRoom.jsx:43`); `engine === "fallback"` and `visionOn` are both discarded. No connection or session-expiry state. |
| 2 | Match System / Real World | 3 | Conversation metaphor reads cleanly. But "Done answering" is `variant="danger"` red (`:324`) — stop/destroy color on the primary submit. |
| 3 | User Control and Freedom | 1 | No undo anywhere. 2s of silence auto-submits. `switchToTyping` destroys the in-flight transcript. A failed POST destroys the typed answer. No repeat, no pause, no way to restore fullscreen the warning demands. |
| 4 | Consistency and Standards | 2 | Hand-rolls a warning banner while `Toast.jsx` sits unused; raw `<button>`s instead of `Button`, discarding the 4px focus ring. Breaks the Two-Shadow Rule (`shadow-sm`, `shadow-lg`), the Reserved Verdict Rule (danger red on submit, amber for a proctoring nudge), and the type scale (`text-[10px]`). |
| 5 | Error Prevention | 1 | No route block or `beforeunload` on a non-repeatable proctored session. No draft persistence. No confirm before discarding a transcript. No `maxLength` while the server silently truncates. |
| 6 | Recognition Rather Than Recall | 2 | Always-visible transcript is a real win. But the auto-submit rule is stated once at 12px slate-400 and never restated during the pause that triggers it; consent scope and the fullscreen requirement live one screen back. |
| 7 | Flexibility and Efficiency | 2 | Voice/text duality and Ctrl/⌘+Enter are genuine. But no keyboard way to end a spoken turn, no skip/replay, and switching text→voice mid-question breaks the mic entirely. |
| 8 | Aesthetic and Minimalist Design | 2 | The card is calm — and then a 7-tab-stop app navbar renders above it. Weight is allocated backwards: `text-2xl` "AI Interview" is the largest element; the survival instructions are the smallest. |
| 9 | Error Recovery | 1 | All errors funnel into one 12px red `<p>` with no role, no retry, no diagnosis. "Could not submit your answer." arrives *after* the answer is erased. |
| 10 | Help and Documentation | 1 | Zero help affordance on a screen whose user has, by product definition, no account, no training, and no support channel. |
| **Total** | | **17/40** | **Poor — major UX overhaul required** |

## Design Specificity Verdict

**LLM assessment:** This is a generic LLM chat wrapper wearing a proctoring badge. Strip the phase machine and the 10px "Monitored" chip and what remains is the 2023 default: avatar bubbles, right-aligned brand-filled user messages, a 3-row textarea with Ctrl/⌘+Enter, and an "Interviewer is thinking…" spinner. Rename one string and it ships as a support bot or a tutoring app, unchanged.

Nothing in the composition expresses the product's actual thesis. PRODUCT.md positions this as *"we extract what your résumé claims, prove which we can verify, hand the interview the ones we can't, and show our work"* — the interview is supposed to be the **probe** half of Claim → Probe → Verdict — and DESIGN.md's north star is *"a ledger, not a dashboard that asserts."* This screen shows the candidate zero claims, zero criteria, zero record. It looks like a conversation being had, not a record being kept. For a product whose stated mandate is that "the same thing but with a better model is a rejected answer," the single highest-stakes surface is the most interchangeable one in the repo.

**Deterministic scan:** `detect.mjs` across `InterviewRoom.jsx`, `PreInterviewCheck.jsx`, `InterviewLogin.jsx`, and `InterviewDashboard.jsx` returned **exit 0, zero findings**. Assessment B verified this was a real clean result, not a broken run — `--help` works, all four files were confirmed on disk, a non-JSON re-run also returned clean, and no `detector.ignore*` suppression keys exist in project config. The mechanical slop detector has nothing to say about this screen; every issue below is a judgment or an evidence finding, not a lint hit.

**Static contrast evidence (Assessment B, computed from class names — estimates, not rendered measurements):**

| Text | Background | Location | Ratio | Verdict |
|---|---|---|---|---|
| `text-slate-400` `#94a3b8` | white | `:303, :323, :335, :339, :358` | 2.56:1 | Fails AA (5 occurrences) |
| `text-slate-400` `#94a3b8` | `bg-slate-50` | `:286` | 2.45:1 | Fails AA |
| `text-slate-500` `#64748b` | `bg-slate-100` | `:274-276` | 4.34:1 | Fails AA (narrow) |
| `text-slate-300` icon | white | `PreInterviewCheck.jsx:33` | 1.49:1 | Fails 1.4.11 — status-conveying, not decorative |

Touch targets: the three bare `<button>` escape hatches (`:303`, `:339`, `:360`) carry no padding classes — roughly **16px tall**, below even WCAG 2.2 AA's 24×24 floor. `Button size="sm"` is 32px and default `md` is 40px; both clear the 24px AA minimum but miss the 44px platform convention.

**Visual overlays:** none. No browser automation tool exists in this session — Assessment B confirmed by direct tool search rather than assumption, did not start a dev server, and did not fabricate an overlay. No user-visible overlay is available.

## Overall Impression

The engineering here is more careful than the design. There is a real voice phase machine, real proctoring, a real fallback to typing — someone thought hard about the hard parts. But the screen was assembled from chat-UI defaults rather than designed for the person actually sitting in front of it, and the result is a surface where the accommodation paths are the least visible elements, the escape hatches are unstyled 16px text links, and three separate ways exist to lose an answer that cannot be re-recorded.

The single biggest opportunity is not visual. It is that **the candidate sees none of the evidence loop the product is built on.** Show them which résumé claim the current question is probing and this screen stops being copyable overnight — and it becomes the first candidate-facing expression of the thing the company is actually selling.

## What's Working

1. **The voice phase machine (`:309-338`) is the best-designed thing in the candidate app.** Exactly one state visible at a time, each with a distinct verb, icon, and color. It never shows two spinners and never asks the candidate to hold two ideas at once — correct discipline for a hands-free interaction where the user's eyes may not be on the screen.
2. **The muted live-interim bubble (`:284`, `Bubble` `muted` at `:28`).** Rendering in-progress transcription at 70% opacity, visually distinct from committed turns, is an honest distinction between *heard* and *hearing*. It is the one place on this screen that obeys PRODUCT.md's binding rule 5 — uncertainty made visible rather than styled as fact.
3. **The always-on transcript with smooth auto-scroll (`:110-112`, `:280-283`).** Every question stays readable in text while it is spoken. For someone on a phone in a noisy room, or reading English faster than they parse it aloud, this is the accommodation that actually matters — and it costs the design nothing.

## Priority Issues

### [P0] A failed submit destroys the candidate's answer — voice or typed — with no draft and no retry
`submitAnswer` clears the input at `:121` and optimistically appends the turn at `:120`; on failure it calls `load()` at `:127`, which overwrites state from the server and erases the optimistic bubble. The typed text is already gone. On the voice path it is worse: `finishListening()` has already torn down the stream, so the transcript existed only in the bubble that just vanished.

**Why it matters:** this user is on mobile data with one shot at a job. A three-minute spoken answer disappears into a 12px "Could not submit your answer."

**Fix:** hold the payload in a ref; on failure restore the textarea (or render the voice transcript into an editable textarea), leave the optimistic bubble in place tagged "not sent," and show an explicit **Retry**. Persist in-progress answers to `sessionStorage` so a refresh cannot eat them.
**Suggested command:** `/impeccable harden`

### [P0] Two seconds of silence auto-submits, with no undo, contradicting the screen's own promise
`utterance_end_ms` defaults to `2000` (`useVoiceInterview.js:166`) and `UtteranceEnd` calls straight through to submit. The rule is disclosed once, at 12px slate-400 (`:323`) — while the header promises "There's no time pressure" (`:270`).

**Why it matters:** a nervous, non-native speaker pausing to find a word is the *expected* behavior of this exact user. Their turn ends mid-thought and there is no "wait, I wasn't finished."

**Fix:** raise the silence threshold to 4–5s for interview context; on `UtteranceEnd` show a 5-second "Ending your turn… **Keep talking**" affordance before submitting, reopening the mic if they speak or tap. Restate the rule *during* the pause at full contrast.
**Suggested command:** `/impeccable harden`

### [P0] The full app navbar renders during a proctored interview, and the completion CTA dead-ends
`InterviewRoom` is nested inside `AppShell` (`App.jsx:46, 69`), so `AppNavbar` renders 7–8 tabbable destinations above the interview, including a thumb-adjacent mobile hamburger. One tap unmounts the room, firing proctoring and voice teardown — with no route block, no `beforeunload`, and no confirmation. At the other end, the completed-state button (`:232`, labeled "Back to my dashboard") navigates to `/dashboard`, which is wrapped in `RequireAccount` (`App.jsx:78-85`) — and the interview-portal candidate has **no account by definition**. The final click of the highest-stakes flow bounces them to a login screen for credentials that do not exist.

**Why it matters:** the peak-end rule is being violated by a routing bug, and an unrepeatable assessment is one accidental tap from abandonment.

**Fix:** give `/portal/pre-check` and `/portal/interview` a bare shell — wordmark, job name, monitored indicator, help link, nothing navigable. Add `beforeunload` plus a router block with an explicit "Leaving ends your interview" confirmation. Point the completion CTA at `/portal/dashboard`.
**Suggested command:** `/impeccable harden`

### [P1] Failures render as a permanent false progress spinner, and both degraded-mode signals are discarded
`phase === "idle" && !sending` (`:334-338`) is a catch-all rendering "Preparing the next question…" with no timeout, retry, or error. It is deterministically reachable: switch to typing, then click "Use voice instead" (`:362`) — neither handler resets `handledRef`, so the orchestration effect bails at `:141`, the mic never reopens, and the candidate watches a spinner forever. Meanwhile `state.engine === "fallback"` (canned questions, no LLM) and `visionOn === false` are both available and both discarded, and `voice.error` — which carries "Voice connection dropped — you can type your answer instead" — is never destructured at `:43`, so it can never render. On a dropped socket the green "Listening" indicator pulses over a dead connection while the candidate talks into nothing.

**Why it matters:** this directly violates two binding rules in PRODUCT.md — *"degraded / fallback / no-key paths must be labelled as such everywhere they surface"* and *"never render a placeholder as if it were a measurement."* A spinner that never resolves is a placeholder presented as progress.

**Fix:** reset `handledRef.current = null` in `switchToTyping` and the voice-restore handler; add a ~20s watchdog on the idle branch surfacing a real error with **Retry** and **Type instead**; destructure and render `voice.error`; add a neutral, explicitly-labelled banner when `engine === "fallback"` and when the vision tier is unavailable.
**Suggested command:** `/impeccable harden`

### [P1] The accommodation paths are the least visible elements, and the app has zero live-region support
The recovery controls at `:303` and `:339` are raw `<button>`s in `text-xs text-slate-400` — **2.56:1**, failing even non-text contrast — with **no focus ring**, directly contradicting DESIGN.md's stated Do: *"keep the 4px focus ring… the only affordance a keyboard-only candidate has mid-interview."* A grep across all of `user/src` returns **zero** `aria-live`, `role="alert"`, `role="status"`, `role="log"`, or `sr-only` — verified directly. Every phase transition, the thinking state, each proctoring warning, and each new AI question are **silent to a screen reader**. The textarea at `:346` has no label while `Field.jsx:38` exports an unused `Label`.

**Why it matters:** PRODUCT.md records accessibility as "best effort, no formal standard." That is a recorded fact about commitments — not a licence for a proctored employment assessment to be screen-reader-inoperable.

**Fix:** promote both escape hatches to `Button variant="secondary"` with real hit areas; add `role="status" aria-live="polite"` to the phase strip and transcript, `role="alert"` to the warning banner and error slot; label each bubble with its speaker; move informational slate-400 text to slate-600 minimum.
**Suggested command:** `/impeccable audit`

## Persona Red Flags

**Sam (screen reader / keyboard-only / low vision / motor)**
- Cannot tell when the microphone is open. The entire interaction state is communicated through color, icon, and animation with no live region. The verified absence of `aria-live` anywhere in `user/src` makes this screen **non-operable by screen reader**, not merely degraded.
- The proctoring warning appears and self-destructs in 4.5s with no `role="alert"` — Sam is flagged and never told.
- `Bubble` puts the speaker only in a decorative SVG; the log reads as an unattributed wall of text. Sam cannot tell where the question ends and their answer begins.
- No skip-link past the 7-item navbar; no keyboard way to end a spoken turn or interrupt the AI.
- The auto-submit rule, the typing fallback, and the thinking indicator all sit at ~2.6:1. The "Monitored" chip is `text-[10px]`, outside the type scale entirely.

**Casey (distracted mobile, one-handed, interruptible)**
- **Being interrupted is itself an integrity violation.** Any app switch fires `visibilitychange` → `tab_switch` → an amber warning logged to the server. Taking a call during a phone interview becomes a recorded event, and nothing warns her *before* it happens.
- The fixed self-view (`bottom-4 right-4 h-24 w-32 z-40`) sits directly over "Send answer" in text mode and "Done answering" in voice mode at 375px.
- `max-h-[52vh]` plus a sticky 64px navbar plus the mobile keyboard pushes the compose control below the fold; on iOS Safari `vh` resolves to the large viewport, worsening it.
- The hamburger is a one-tap, thumb-reachable, unconfirmed exit from an unrepeatable interview.

**Riley (deliberate stress tester)**
- **Refresh mid-interview:** the start-gesture card reappears, fullscreen is gone with no indicator and no way to restore it — while the warning copy says "please return to it to continue," an instruction the room provides no control for.
- **Text → voice round trip:** two clicks produce a permanent fake spinner. A soft-lock disguised as progress.
- **Long input:** no `maxLength` on the textarea while the server silently truncates. No counter. The candidate never learns their answer was cut.
- **Broken camera at the room (not pre-check):** the self-view container becomes `hidden`, `monitoring` stays false, Tier-1 proctoring runs anyway, and nothing on screen indicates the camera is off.
- **Token expiry mid-interview:** the portal JWT is capped at `session.expiresAt` and the axios interceptor refreshes **account** tokens only. Every subsequent answer 401s into "Could not submit your answer." in a loop — while "There's no time pressure" stays on screen.
- **Paste in text mode:** fires a "Pasting isn't allowed" warning, *and the paste lands anyway*. The candidate is warned for something the UI permitted.

## Minor Observations

- `Question N / M` (`:275`) freezes during the thinking gap, so the counter lags actual state. `maxQuestions` is unknowable until after the interview starts — neither the dashboard nor the pre-check discloses interview length.
- Loading states are inconsistent across two adjacent screens in one flow: `InterviewDashboard.jsx:97-99` uses `Skeleton`; `InterviewRoom.jsx:197-206` uses a centered spinner in a Card.
- `Toast.jsx` exists, is byte-shared with admin, and is unused here — the warning banner is a hand-rolled reimplementation with a different radius, position, and dismissal model.
- `Bubble` uses `rounded-2xl` (the *container* radius) for a message, plus `shadow-sm`; the self-view uses `shadow-lg`. Both are ad-hoc shadows outside the two-token vocabulary.
- Amber on the proctoring warning spends the Reserved Verdict channel (amber = "awaiting a human") on a non-pipeline meaning.
- First-person AI voice ("I'm listening", "I didn't catch that") anthropomorphizes the assessor and is unratified in either PRODUCT.md or DESIGN.md — worth a deliberate decision rather than an accident.
- `switchToTyping` (`:185-188`) doesn't clear `handledRef`, doesn't warn, and doesn't offer the discarded transcript as a starting draft — three small mercies missed in one four-line function.
- The self-view has no mute/hide control. A candidate distracted by their own face has no recourse.
- One `error` string serves fatal load failure, mic failure, transcription failure, and submit failure, with no severity distinction.

## Questions to Consider

1. **If this product's entire claim is "we show our work," why does the candidate see none of it?** What if the room showed, live, which résumé claim the current question is probing — "You listed 4 years of Kafka; this question tests that"? That single move makes the screen impossible to copy and becomes the first candidate-facing expression of Claim → Probe → Verdict.
2. **Why is silence the submit button?** Every other interface treats a pause as thinking. What if the turn ended only on an explicit "That's my answer," with pauses recorded as delivery *data* rather than used as a submission trigger?
3. **What does this screen owe a candidate whose camera dies?** Right now, nothing — it goes dark and keeps scoring. Should the interview visibly downgrade, so degradation lands on the *record* rather than on the candidate?
4. **Is the interview a page, or is it a mode?** As long as it renders inside `AppShell` it is always one tap from abandonment. What if it were a full-viewport mode with its own chrome and a deliberate exit, the way a video call is?
5. **Who does the candidate talk to when something breaks?** PRODUCT.md states they have no support channel. Is that a constraint, or an unexamined default?
