// The things a candidate says that are ABOUT the interview rather than answers to it.
//
// "I don't know." "Can we skip this one?" "Actually, I don't want to do this." "Give me a second."
//
// Every one of those is a normal move in a human conversation and the pipeline had no concept of
// any of them. A candidate who said "I don't know" had it recorded as their answer, scored as a
// weak one, and heard nothing back before the next question arrived. A candidate who wanted to
// stop had no way to stop: `aiInterview.status` went not_started → in_progress → completed and
// there was no other exit. That is the single thing in this system that could actually trap
// someone, and it is what this file exists to fix.
//
// WHY THIS IS DETERMINISTIC AND NOT A MODEL CALL — the same argument as utils/repeatIntent.js and
// utils/finishIntent.js, and it gets stronger the more consequential the act is:
//   - A model round-trip mid-turn is slow, and these have to land in the moment. "I don't know"
//     answered four seconds later is not a conversation.
//   - It is non-reproducible. "Why did this interview end?" must be answerable from a stored
//     trigger phrase and a rule, not from what a model felt about an utterance once.
//   - A model asked "did they want to stop?" will sometimes say yes when they did not. Ending an
//     interview is irreversible for that candidate. The asymmetry between the two errors is
//     enormous, so the detection has to be something a human can read, argue with, and change.
//
// WHAT WE DO NOT DO: hand the microphone to a speech-to-speech model and let it decide when to be
// understanding. That is the competing product, and it cannot tell you afterwards what it said or
// why it stopped. Here the acts are a closed set, the responses come from the approved bank
// (utils/backchannel.js), and the decision rule is thirty lines of code.

// ---------------------------------------------------------------------------
// The acts
// ---------------------------------------------------------------------------
//
// `maxOtherWords` is the safety rule, and it is doing most of the work. An act is only an act
// when it is essentially the WHOLE of what the candidate said. The same words buried in a real
// answer mean something completely different:
//
//   "I don't know."                                  → a decline.
//   "I don't know the exact number, but we ran        → an answer, and a good one. Treating this
//    three brokers and the lag never went above…"       as a decline would discard evidence.
//
// So the test is not "does the phrase appear" but "is there anything else in this turn". That is
// why the limits are tight, and why `withdraw` is tighter than the rest.

const ACTS = {
  // The most consequential act in the system: the candidate wants out.
  //
  // maxOtherWords is 3 — far tighter than the others — AND it requires a spoken confirmation
  // before anything happens (see needsConfirmation). Both, not either. Consider the phrase this
  // has to survive: "I don't want to do this manually, so I wrote a script that…". That is a
  // candidate answering a question well, and a looser rule would end their interview for it.
  withdraw: {
    triggers: [
      "i don't want to do this",
      "i do not want to do this",
      "i don't want to continue",
      "i don't want to carry on",
      "i want to stop",
      "i'd like to stop",
      "i want to end the interview",
      "i'd like to end the interview",
      "can we stop",
      "can we end this",
      "let's stop here",
      "i want to quit",
      "i'm withdrawing",
      "i withdraw",
      "i don't want to continue with this interview",
      "i'm no longer interested",
      "i'd rather not continue",
    ],
    maxOtherWords: 3,
    needsConfirmation: true,
  },

  // "I don't know." Not a failure state — a normal and honest thing to say, and the interviewer
  // should react to it the way a person would: acknowledge it, don't dwell, move on. What it must
  // NOT do is get scored as a wrong answer (see aiInterviewService: declined turns are excluded
  // from the answer-score mean and reported as declined instead of as a zero).
  decline: {
    triggers: [
      "i don't know",
      "i do not know",
      "i dont know",
      "no idea",
      "i have no idea",
      "i'm not sure",
      "i am not sure",
      "i couldn't say",
      "i can't answer that",
      "i cannot answer that",
      "i've never used that",
      "i have never used that",
      "i've not used that",
      "i haven't worked with that",
      "i have not worked with that",
      "i've not come across that",
      "that's not something i've done",
      "can we skip this",
      "can we skip that",
      "can i skip this",
      "let's skip this",
      "skip this one",
      "i'd rather skip this",
      "i'll pass on this",
      "pass on this one",
    ],
    // Roomier than withdraw because the natural forms carry filler and an apology: "um, honestly,
    // I don't know that one, sorry." Still small enough that any real attempt at an answer wins.
    maxOtherWords: 6,
    needsConfirmation: false,
  },

  // "Give me a second." Cheap to honour and it costs the candidate nothing to ask, so the bar is
  // low. Handled purely as patience — it stops the silence clock and says so out loud. It creates
  // no turn and touches no score.
  pause: {
    triggers: [
      "give me a second",
      "give me a moment",
      "give me a minute",
      "can i have a second",
      "can i have a moment",
      "can i have a minute",
      "can we pause",
      "can i take a moment",
      "let me think about that",
      "let me think for a second",
      "just a moment",
      "hold on a second",
      "bear with me",
    ],
    maxOtherWords: 4,
    needsConfirmation: false,
  },
};

// Checked in this order, so an utterance that matches two is read as the more consequential one.
// The lists barely overlap in practice; the order is here so that when they do, the reading is
// fixed and stated rather than incidental to object key order.
const ACT_ORDER = ["withdraw", "decline", "pause"];

// ---------------------------------------------------------------------------
// Confirming a withdrawal
// ---------------------------------------------------------------------------
//
// Ending an interview is the one action here that cannot be undone by the candidate, so it is the
// one action that is never taken on a single utterance. The interviewer asks (from the approved
// bank), and only an affirmative to that question ends anything.
//
// THE DEFAULT IS ALWAYS "CARRY ON". Anything that is not a recognised yes — a no, silence, a
// half-sentence, a cough, an unrecognised phrase — resumes the interview. That asymmetry is the
// entire point: continuing a candidate who wanted to stop costs them one more question, which
// they can decline; stopping a candidate who did not want to stop costs them the job.

const CONFIRM_YES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "correct",
  "that's right",
  "i'm sure",
  "i am sure",
  "please end it",
  "end it",
  "end the interview",
  "stop it",
  "let's stop",
  "i'd like to stop",
  "i want to stop",
  "confirm",
];

const CONFIRM_NO = [
  "no",
  "nope",
  "carry on",
  "keep going",
  "continue",
  "let's continue",
  "let's carry on",
  "i'll carry on",
  "i want to continue",
  "sorry no",
  "my mistake",
  "never mind",
  "ignore that",
  "i didn't mean that",
];

// A confirmation has to be a short, direct reply. Past this, the candidate has started talking
// about something else and this is not an answer to "would you like to end here?".
const CONFIRM_MAX_WORDS = 8;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function wordList(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

// Word-sequence matching, not substring: "no idea" must not fire inside "no ideas were rejected".
// Apostrophes are optional throughout because transcription is inconsistent about them
// ("don't" / "dont"), which is also why the trigger lists above carry both spellings of the
// commonest forms rather than relying on this alone.
function toWordRegex(phrase) {
  const words = String(phrase || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  if (!words.length) return null;
  const parts = words.map((w) => w.replace(/'/g, "'?"));
  return new RegExp(`\\b${parts.join("[^a-z0-9]+")}\\b[.,;:!?…]*`, "gi");
}

// The longest trigger that appears, and what it actually matched. Longest wins because it is the
// most complete account of what was said: "i don't want to continue with this interview" should
// be reported as itself, not as the "i don't want to continue" hiding inside it.
function matchLongest(text, triggers) {
  let best = null;
  for (const trigger of [...triggers].sort((a, b) => String(b).length - String(a).length)) {
    const re = toWordRegex(trigger);
    if (!re) continue;
    const m = re.exec(String(text));
    if (!m) continue;
    if (!best || m[0].length > best.matchedText.length) {
      best = { trigger, matchedText: m[0], index: m.index };
    }
    break; // sorted longest-first, so the first hit is the longest that matches
  }
  return best;
}

/**
 * What act, if any, this utterance is.
 *
 * Returns { act, matchedTrigger, otherWords, honour, needsConfirmation }.
 *
 * `honour` is the decision. Callers act on `honour`, never on a bare `act` — an act that was
 * detected but not honoured is a phrase inside a real answer, and the answer is what matters.
 */
function detect(transcript, { acts = ACTS, order = ACT_ORDER, limits = {} } = {}) {
  const text = String(transcript == null ? "" : transcript);
  const totalWords = wordList(text).length;
  const none = { act: null, matchedTrigger: null, otherWords: totalWords, honour: false, needsConfirmation: false };
  if (!totalWords) return none;

  for (const name of order) {
    const cfg = acts[name];
    if (!cfg) continue;
    const hit = matchLongest(text, cfg.triggers);
    if (!hit) continue;
    const otherWords = Math.max(0, totalWords - wordList(hit.matchedText).length);
    const max = Number.isFinite(limits[name]) ? limits[name] : cfg.maxOtherWords;
    return {
      act: name,
      matchedTrigger: hit.trigger,
      otherWords,
      honour: otherWords <= max,
      needsConfirmation: Boolean(cfg.needsConfirmation),
    };
  }
  return none;
}

/**
 * Read a reply to "would you like to end the interview here?".
 *
 * Returns "yes" | "no" | null. `null` means "not a recognisable answer to that question", and
 * every caller treats null exactly like "no" — see the asymmetry note above. It is returned
 * distinctly from "no" only so the session can record which of the two actually happened.
 */
function detectConfirmation(transcript, { maxWords = CONFIRM_MAX_WORDS } = {}) {
  const text = String(transcript == null ? "" : transcript);
  const words = wordList(text);
  if (!words.length || words.length > maxWords) return null;

  // "No" is checked FIRST and wins outright. "No, yes I mean carry on" must never be read as a
  // yes, and more importantly the failure direction of a tie has to be the recoverable one.
  const no = matchLongest(text, CONFIRM_NO);
  if (no) return "no";
  const yes = matchLongest(text, CONFIRM_YES);
  if (yes) return "yes";
  return null;
}

// ---------------------------------------------------------------------------
// Client policy
// ---------------------------------------------------------------------------

// Shipped to the browser with the streaming credential, exactly like the repeat and finish
// triggers. Detection runs client-side because it has to be instant; WHAT counts as each act
// stays server-owned, so a tenant's interview conditions live in one place and the client never
// invents a rule. The server re-checks every act it is told about (see the portal controller) —
// this is a latency optimisation, not a delegation of the decision.
function clientPolicy() {
  return {
    dialogueActs: {
      withdrawTriggers: [...ACTS.withdraw.triggers],
      declineTriggers: [...ACTS.decline.triggers],
      pauseTriggers: [...ACTS.pause.triggers],
      maxOtherWords: {
        withdraw: Number(process.env.VOICE_WITHDRAW_MAX_OTHER_WORDS || ACTS.withdraw.maxOtherWords),
        decline: Number(process.env.VOICE_DECLINE_MAX_OTHER_WORDS || ACTS.decline.maxOtherWords),
        pause: Number(process.env.VOICE_PAUSE_MAX_OTHER_WORDS || ACTS.pause.maxOtherWords),
      },
      confirmYes: [...CONFIRM_YES],
      confirmNo: [...CONFIRM_NO],
      confirmMaxWords: Number(process.env.VOICE_CONFIRM_MAX_WORDS || CONFIRM_MAX_WORDS),
      // How long to wait for a reply to "would you like to end the interview here?" before
      // treating the silence as "carry on". Generous, because the alternative reading of silence
      // here is the irreversible one.
      withdrawConfirmGraceMs: Number(process.env.VOICE_WITHDRAW_CONFIRM_GRACE_MS || 12000),
      // Extra listening window bought by "give me a second", on top of the ordinary patience.
      pauseGraceMs: Number(process.env.VOICE_PAUSE_GRACE_MS || 30000),
    },
  };
}

module.exports = {
  ACTS,
  ACT_ORDER,
  CONFIRM_YES,
  CONFIRM_NO,
  CONFIRM_MAX_WORDS,
  detect,
  detectConfirmation,
  clientPolicy,
};
