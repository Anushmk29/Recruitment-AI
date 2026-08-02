// The interviewer's non-evaluative speech — the small conversational moves that make a spoken
// interview feel like a conversation instead of a form read aloud.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: the persona is a RENDERER, not an AUTHOR. The
// interviewer's questions are compiled from the versioned RoleRubric and the candidate's claim
// probes (services/aiInterviewService) — that is the test instrument, and it stays
// byte-for-byte auditable. Everything in this file is the wrapper's small talk: a fixed,
// human-approved bank of speech acts that say nothing whatsoever about the candidate.
//
// Why a fixed bank instead of letting a model improvise warmth:
//   - A warm, chatty model drifts toward the questions you cannot legally ask — family, age,
//     health, visa status — because that is what human small talk is made of. Competitors who
//     hand the whole interview to a speech-to-speech model have no defence when a candidate
//     says "the AI asked me about my kids".
//   - "What did the interviewer say?" becomes answerable from a constant, which is what lets
//     code verify that nothing off-script was spoken.
//   - Every candidate hears phrasing drawn from the same list, so interviewer warmth is a
//     constant of the test conditions rather than a per-candidate variable.
//
// Backchannels are NOT turns. They are never pushed into aiInterview.turns, never added to
// askedQuestions, never scored, and never shown to a reviewer as interviewer questions. They
// are recorded on aiInterview.backchannels purely so the real conditions of the interview are
// reconstructible.

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

const BANK = {
  // Silence handling — the candidate has stopped speaking but has not finished thinking.
  // Ordered gentlest-first: an offer of time, then a lighter-touch "still here".
  reassure: [
    "Take your time — I'm here.",
    "No rush at all. I'm still here whenever you're ready.",
    "Whenever you're ready — take the time you need.",
  ],
  // Spoken before re-reading a question the candidate asked us to repeat.
  repeat: ["Of course — here it is again.", "No problem. Let me read that again."],
  // Spoken after an answer lands, while the next question is being prepared. Fills the dead
  // air that otherwise makes the interviewer feel like a machine between turns.
  //
  // Warmer than a bare "Thank you." — candidates report the old wording as talking into a void —
  // but still saying NOTHING about the answer. Note what is deliberately absent: no "that's
  // helpful", no "well answered", no "you sound experienced". Warmth here is UNIFORM (the same
  // rotation for every candidate at the same turn index, see phraseFor) which is what keeps it a
  // constant of the test conditions. Warmth that varied with how well someone answered would be
  // differential encouragement — a bias vector, a contamination of the measurement, and an
  // assessment delivered to the candidate with no human in the loop.
  acknowledge: [
    "Thank you.",
    "Got it — thank you.",
    "Thank you, I've noted that.",
    "Thanks. Let me move on to the next one.",
  ],
  // Spoken when the candidate has gone quiet and we believe the answer is finished, BEFORE
  // treating it as finished. Candidates consistently report being cut off mid-thought; this
  // makes the end of a turn their decision rather than a timer's, and it costs ~3 seconds
  // instead of the fixed minute-long wait that would otherwise be needed to feel unhurried.
  confirm: ["Anything you'd like to add?", "Is there anything else you'd like to add?"],
};

const KINDS = Object.keys(BANK);

// ---------------------------------------------------------------------------
// The non-evaluative guarantee
// ---------------------------------------------------------------------------

// Words that would turn a backchannel into feedback. A backchannel may acknowledge that the
// candidate spoke; it must never signal how well they did. Differential encouragement is both
// a bias vector (warmth lands unevenly across candidates) and a contamination of the
// measurement itself — praise changes what a candidate says next, so an interview that praises
// some answers and not others is no longer measuring the same thing for everyone.
const EVALUATIVE_WORDS = [
  "great", "good", "excellent", "perfect", "interesting", "impressive", "nice", "well done",
  "exactly", "right", "correct", "wrong", "strong", "weak", "brilliant", "amazing", "wow",
  "love", "clever", "smart", "poor", "unfortunately", "concerning",
  // Added after a candidate asked for exactly this ("Well answered — you seem very experienced
  // on this project"). It is the most natural-sounding request in the world and it is an
  // assessment delivered to the candidate mid-interview with no human in the loop: it varies
  // with the answer, it changes what they say next, and it contradicts the report if they are
  // later rejected. Warmth ships as UNIFORM phrasing instead (see the acknowledge bank).
  // "helpful" is here for the same reason — "that's helpful" sounds harmless and still rates
  // the answer.
  "well answered", "helpful", "experienced", "thorough", "solid", "detailed", "insightful",
  "thoughtful", "compelling",
];

function findEvaluativeWord(phrase) {
  const lower = String(phrase || "").toLowerCase();
  return (
    EVALUATIVE_WORDS.find((w) => new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`).test(lower)) || null
  );
}

// Checked at require time, not only in tests: the bank is a static constant, so a phrase that
// smuggles in evaluative language is a programming error. Failing at boot means it is caught on
// deploy, never discovered later in a live candidate's interview.
for (const [kind, phrases] of Object.entries(BANK)) {
  for (const phrase of phrases) {
    const offender = findEvaluativeWord(phrase);
    if (offender) {
      throw new Error(
        `[backchannel] "${phrase}" (${kind}) contains evaluative language ("${offender}"). ` +
          "Backchannels acknowledge that the candidate spoke; they never signal how well."
      );
    }
  }
}

function phrases(kind) {
  return [...(BANK[kind] || [])];
}

function allPhrases() {
  return KINDS.flatMap((k) => BANK[k]);
}

// Deterministic rotation rather than a random pick: varied enough not to sound robotic, and
// reproducible from the index alone when reconstructing what a candidate heard.
function phraseFor(kind, index) {
  const list = BANK[kind];
  if (!list || !list.length) return "";
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return list[i % list.length];
}

function isBankPhrase(phrase) {
  return allPhrases().includes(String(phrase || ""));
}

// ---------------------------------------------------------------------------
// Echo removal — our voice must never be scored as the candidate's
// ---------------------------------------------------------------------------

// A backchannel is spoken while the microphone is open. The client pauses capture around
// playback, but that has a race (audio already in flight) and browsers vary, so this is the
// server-side backstop: if the interviewer's own words landed in the candidate's transcript,
// strip them before anything reads that transcript as evidence.
//
// `spoken` is the client's report of which backchannels played during this turn, and it is
// intersected with the bank first. That intersection is what makes trusting the client safe:
// the worst a lying client can do is delete a content-free phrase from its own answer, and a
// candidate whose turn had no backchannel never has their own words touched.
function toWordRegex(phrase) {
  const words = String(phrase || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  if (!words.length) return null;
  // Apostrophes are optional because transcription is inconsistent about them ("I'm" / "im"),
  // and any run of non-alphanumerics counts as the gap between words, since the spoken form
  // will not carry our written punctuation.
  const parts = words.map((w) => w.replace(/'/g, "'?"));
  // Trailing sentence punctuation is consumed with the phrase. Without this, stripping "Thank
  // you." out of "That's the whole design. Thank you." leaves the phrase's own full stop behind
  // as a stray "..". Punctuation only, never whitespace, so the words either side stay separated.
  return new RegExp(`\\b${parts.join("[^a-z0-9]+")}\\b[.,;:!?…]*`, "gi");
}

function stripEcho(transcript, spoken) {
  const original = String(transcript == null ? "" : transcript);
  const claimed = (Array.isArray(spoken) ? spoken : [])
    .map((s) => (typeof s === "string" ? s : s?.phrase))
    .filter(isBankPhrase);
  if (!claimed.length) return { text: original, removed: [] };

  let text = original;
  const removed = [];
  for (const phrase of [...new Set(claimed)]) {
    const re = toWordRegex(phrase);
    if (!re) continue;
    const next = text.replace(re, " ");
    if (next !== text) {
      removed.push(phrase);
      text = next;
    }
  }
  // Tidy the seams left behind, without touching the candidate's own punctuation elsewhere.
  text = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return { text, removed };
}

// ---------------------------------------------------------------------------
// Client policy
// ---------------------------------------------------------------------------

// Timing policy handed to the browser with the streaming credential. The browser owns the
// silence detection (it is the only place that knows in real time), but not the numbers or the
// words — those stay server-side so a tenant's interview conditions are configured in one place.
function clientPolicy() {
  return {
    reassurances: phrases("reassure"),
    acknowledgements: phrases("acknowledge"),
    repeatPreambles: phrases("repeat"),
    confirmations: phrases("confirm"),
    // How long the candidate has to answer "anything you'd like to add?" before the turn really
    // ends. Long enough to draw breath and start a sentence — any new speech cancels the ending
    // outright and hands the floor straight back.
    confirmGraceMs: Number(process.env.VOICE_CONFIRM_GRACE_MS || 5000),
    // How many times one turn may be reassured before silence is finally taken as "finished".
    // Beyond this, more reassurance stops being supportive and starts being a loop.
    maxReassurancesPerTurn: Number(process.env.VOICE_MAX_REASSURANCES || 2),
    // Silence after the candidate HAS spoken and then stopped. Long, because the candidate has
    // just been told to take their time — a 4s window would make that offer a lie.
    postReassuranceGraceMs: Number(process.env.VOICE_POST_REASSURANCE_GRACE_MS || 9000),
    // Silence after the question, before the candidate has said anything at all. This is the
    // moment the old pipeline handled worst: it waited forever in total silence.
    initialSilenceMs: Number(process.env.VOICE_INITIAL_SILENCE_MS || 6000),
  };
}

module.exports = {
  BANK,
  KINDS,
  EVALUATIVE_WORDS,
  findEvaluativeWord,
  phrases,
  allPhrases,
  phraseFor,
  isBankPhrase,
  stripEcho,
  clientPolicy,
};
