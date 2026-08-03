// What does the candidate actually want right now?
//
// THE COMPLAINT THIS ANSWERS. Until now the interviewer understood a fixed list of phrasings and
// nothing else. Say "could you repeat that" and it repeated; say "sorry, I didn't follow that last
// bit" and it recorded confusion as your answer and moved on. That is a command line wearing a
// voice, and every candidate who phrased something the third way discovered the seam.
//
// ---------------------------------------------------------------------------
// WHY A MODEL IS ALLOWED TO DO THIS, WHEN IT IS NOT ALLOWED TO SCORE
// ---------------------------------------------------------------------------
//
// The product rule is that the model never emits the score, because a score is an ASSESSMENT of a
// candidate and has to be reproducible, auditable and defensible. Working out that "sorry, what?"
// means "say it again" is not an assessment. It is CONDUCT — how the interviewer behaves in the
// room — and it never touches a rubric criterion, an answer score, a probe verdict, or a
// recommendation. Nothing downstream of this file can read an intent classification as evidence
// about the candidate.
//
// So the split is: understanding is open-ended, consequences are closed.
//
//   - The model may interpret anything a person might say, with full context.
//   - It may only ever resolve that to one of the ACTIONS below — a closed set defined here.
//   - The words the interviewer says back come from the approved bank (utils/backchannel.js),
//     never from the model.
//   - Every classification is stored with the utterance that produced it, so "why did it do that?"
//     is answerable from the record rather than from what a model felt at the time.
//
// That last property is the one that was actually at risk, and it is preserved: a stored
// {utterance, context, action, model, promptVersion} row reproduces the decision. Competitors who
// hand the whole microphone to a speech-to-speech model cannot produce that row at all.
//
// ---------------------------------------------------------------------------
// TWO TIERS, IN PARALLEL — NOT ONE REPLACING THE OTHER
// ---------------------------------------------------------------------------
//
// Tier 0 is the existing deterministic matchers (repeatIntent, dialogueActs). They answer in zero
// milliseconds, they cover the plain phrasings that make up most of what people actually say, and
// they cost nothing. They are not a legacy path to be removed — a live turn cannot wait on a
// network round-trip for the common case, and a rule that fires identically for every candidate
// forever is a better rule when it applies.
//
// Tier 1 is the semantic classifier (services/intentService.js). It runs ONLY where Tier 0 is
// silent — the tail of unusual, indirect, or context-dependent phrasings — and it is the tier that
// makes the interviewer feel like it understands rather than matches.
//
// This module owns what they share: the action set, the precedence between actions, and the gate
// every Tier-1 answer has to pass before it is allowed to do anything.

const repeatIntent = require("./repeatIntent");
const dialogueActs = require("./dialogueActs");

// ---------------------------------------------------------------------------
// The closed action set
// ---------------------------------------------------------------------------
//
// Adding a row here is a product decision, not a prompt tweak: it widens what the interviewer can
// be made to do by something a candidate says. Every field exists to make one of those
// consequences explicit at the point the action is defined rather than buried in a caller.
//
//   consumesTurn      the utterance was ABOUT the interview, so it is not the candidate's answer
//                     and must not be scored as one. False for answer_continues alone.
//   needsConfirmation never acted on from a single utterance, however confident the reading.
//   reply             which bank in utils/backchannel.js speaks the response. null = the caller
//                     composes from state (meta questions) or says nothing (answer_continues).
//   tier1             may the semantic tier reach this action at all? Set false for anything whose
//                     cost of being wrong is too high to accept from an inferred reading.

const ACTIONS = {
  // The default, and the destination of every uncertainty in this file. If we are not sure what
  // someone meant, they were answering the question — because the alternative is discarding a
  // real answer, which is the one failure that destroys evidence rather than merely annoying
  // someone.
  answer_continues: {
    consumesTurn: false,
    needsConfirmation: false,
    reply: null,
    tier1: true,
  },

  // "Say that again." The candidate did not HEAR it. Replays the identical audio bytes — never a
  // regenerated question, which would quietly hand this candidate a different test.
  repeat: {
    consumesTurn: true,
    needsConfirmation: false,
    reply: "repeat",
    tier1: true,
  },

  // "What do you mean by that?" The candidate HEARD it and did not UNDERSTAND it. Distinct from
  // repeat, and the distinction is the whole point: replaying the same sentence to someone who
  // already heard it is the most machine-like thing an interviewer can do.
  //
  // Answered from the question's pre-approved restatement, frozen alongside the question itself,
  // never improvised live — see services/questionSetService.js. A restatement composed in the
  // moment would mean two candidates were asked measurably different questions.
  clarify: {
    consumesTurn: true,
    needsConfirmation: false,
    reply: "clarify",
    tier1: true,
  },

  // "I don't know" / "can we skip this". A normal, honest move. Excluded from the answer-score
  // mean and reported as declined rather than as a zero.
  decline: {
    consumesTurn: true,
    needsConfirmation: false,
    reply: "decline",
    tier1: true,
  },

  // "Give me a second." Patience, said out loud, so the silence is visibly theirs.
  pause: {
    consumesTurn: true,
    needsConfirmation: false,
    reply: "pause",
    tier1: true,
  },

  // "How many more of these are there?" A question about the process rather than an answer to
  // one. Answerable from session state, and today it is silently transcribed as the candidate's
  // answer — which is both a lost question for them and a corrupted answer for the record.
  meta_question: {
    consumesTurn: true,
    needsConfirmation: false,
    reply: null, // composed from state, see utils/metaAnswers.js
    tier1: true,
  },

  // "I can't hear you" / "my audio has gone." Not a decline, not a repeat: the pipeline is broken
  // and repeating into a dead speaker helps nobody. The room offers the typed path.
  technical_problem: {
    consumesTurn: true,
    needsConfirmation: false,
    reply: "technical",
    tier1: true,
  },

  // The one irreversible act. Confirmation is required NO MATTER HOW THE READING WAS REACHED —
  // deterministic or inferred — and that is not a limitation of the classifier. Ending an
  // interview on a single utterance is wrong even when the utterance was understood perfectly,
  // because a candidate who misspoke has no way back. Continuing someone who wanted to stop costs
  // them one more question, which they may decline; stopping someone who did not want to stop
  // costs them the job.
  withdraw: {
    consumesTurn: true,
    needsConfirmation: true,
    reply: "withdraw_confirm",
    tier1: true,
  },
};

const ACTION_NAMES = Object.keys(ACTIONS);

// Actions the semantic tier is permitted to return. Kept as a derived constant so the schema in
// services/intentService.js and the gate in this file can never drift apart.
const TIER1_ACTIONS = ACTION_NAMES.filter((a) => ACTIONS[a].tier1);

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------
//
// When more than one reading fits, this order decides. It is not arbitrary and it is not the order
// the actions happen to be declared in:
//
//   withdraw first          — the most consequential reading wins, and it costs nothing to be
//                             wrong about because it only ever asks a question.
//   repeat / clarify / pause next
//                           — all three mean "give me another go at this question". They beat
//                             decline deliberately: a decline is counted against evidence
//                             coverage, so reading "sorry, what was that? I'm not sure" as a
//                             decline takes a question away from someone who was still trying.
//   technical_problem       — before decline for the same reason: a broken microphone is not an
//                             admission of not knowing.
//   decline last            — the reading that costs the candidate something is the reading of
//                             last resort.
//
// meta_question and answer_continues are not in this list: the first is only ever reached by the
// semantic tier, and the second is what you get when nothing else matched.
const PRECEDENCE = ["withdraw", "repeat", "clarify", "pause", "technical_problem", "decline"];

// ---------------------------------------------------------------------------
// Tier 0 — the deterministic matchers, composed
// ---------------------------------------------------------------------------

/**
 * Run every deterministic matcher and return the winner under PRECEDENCE.
 *
 * Composing them here rather than in each caller is a correctness fix in its own right: the
 * browser used to run repeatIntent and dialogueActs independently, so which one won when both
 * matched depended on the order the calls happened to be written in. That is exactly the kind of
 * incidental rule this codebase refuses to have.
 *
 * Returns null when no matcher fired — the signal to consult Tier 1.
 */
function detectDeterministic(transcript, opts = {}) {
  const text = String(transcript == null ? "" : transcript);
  if (!text.trim()) return null;

  const hits = {};

  const rep = repeatIntent.shouldRepeat(text, {
    maxCarryWords: opts.repeatMaxCarryWords,
    triggers: opts.repeatTriggers,
  });
  if (rep.honour) {
    hits.repeat = {
      action: "repeat",
      matchedTrigger: rep.matchedTrigger,
      // What they said that was NOT the request, kept as the start of their answer.
      residue: rep.remainder,
    };
  }

  const act = dialogueActs.detect(text, { limits: opts.actLimits });
  if (act.honour && ACTIONS[act.act]) {
    hits[act.act] = { action: act.act, matchedTrigger: act.matchedTrigger, residue: "" };
  }

  for (const name of PRECEDENCE) {
    if (hits[name]) {
      return {
        ...hits[name],
        tier: 0,
        confidence: 1,
        needsConfirmation: ACTIONS[name].needsConfirmation,
        consumesTurn: ACTIONS[name].consumesTurn,
        reason: `matched "${hits[name].matchedTrigger}"`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 1 — the gate every inferred reading has to pass
// ---------------------------------------------------------------------------

// Below this the reading is not acted on. A model that is unsure what someone meant is describing
// a candidate who was probably just talking, and the safe destination for "probably just talking"
// is their answer.
const MIN_CONFIDENCE = 0.7;

// An utterance longer than this is an answer, whatever else it contains. The same reasoning as
// dialogueActs' maxOtherWords, applied to the semantic tier, and it is doing more work here
// because the classifier has no equivalent of "the trigger was the whole of what they said":
// somebody thirty words into describing an outage is not asking us to repeat anything, however
// much hedging language they used along the way.
const MAX_META_WORDS = 25;

function wordCount(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

/**
 * Validate and gate a raw classifier result before anything acts on it.
 *
 * Everything that fails ANY check becomes answer_continues rather than an error: a classifier
 * that returns nonsense must degrade to "they were answering the question", never to a thrown
 * exception in the middle of somebody's interview.
 *
 * Returns the same shape as detectDeterministic, plus `tier: 1`.
 */
function gateSemantic(raw, transcript, { minConfidence = MIN_CONFIDENCE, maxMetaWords = MAX_META_WORDS } = {}) {
  const fallback = (reason) => ({
    action: "answer_continues",
    tier: 1,
    confidence: Number(raw?.confidence) || 0,
    needsConfirmation: false,
    consumesTurn: false,
    residue: "",
    matchedTrigger: null,
    reason,
  });

  if (!raw || typeof raw !== "object") return fallback("no_classification");

  const action = String(raw.action || "");
  if (!ACTIONS[action]) return fallback(`unknown_action:${action || "none"}`);
  if (!ACTIONS[action].tier1) return fallback(`action_not_available_to_tier1:${action}`);
  if (action === "answer_continues") return fallback("classified_as_answer");

  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < minConfidence) {
    return fallback(`below_confidence:${Number.isFinite(confidence) ? confidence : "none"}`);
  }

  // The length guard, applied AFTER the action check so a long utterance that the classifier read
  // as an answer never even reaches it.
  if (wordCount(transcript) > maxMetaWords) return fallback("too_long_to_be_about_the_interview");

  return {
    action,
    tier: 1,
    confidence,
    needsConfirmation: ACTIONS[action].needsConfirmation,
    consumesTurn: ACTIONS[action].consumesTurn,
    // The classifier may name which part of the utterance was not about the interview, so a
    // half-answer is not thrown away. Never trusted as a rewrite: it has to be a literal substring
    // of what was actually said, verified here, exactly as answer quotes are verified elsewhere.
    residue: literalResidue(raw.residue, transcript),
    matchedTrigger: null,
    // What the model says it understood. Stored on the session, shown to a human reviewing the
    // interview, and never read by any scoring path.
    reason: String(raw.reason || "").slice(0, 300),
    // Only meaningful for meta_question — which of the answerable process questions this was.
    metaTopic: raw.metaTopic ? String(raw.metaTopic).slice(0, 60) : null,
  };
}

// A residue the model invented is worse than no residue: it would put words into the candidate's
// answer that the candidate never said. So it is kept only when it appears verbatim in the
// transcript, the same rule span-verified evidence lives under everywhere else in this codebase.
function literalResidue(residue, transcript) {
  const r = String(residue == null ? "" : residue).trim();
  if (!r) return "";
  return String(transcript || "").toLowerCase().includes(r.toLowerCase()) ? r : "";
}

// ---------------------------------------------------------------------------
// Client policy
// ---------------------------------------------------------------------------

// Shipped to the browser with the streaming credential alongside the other policies. The browser
// runs Tier 0 locally (it must — a live turn cannot wait on the network for the common case) and
// calls the server for Tier 1 only when Tier 0 is silent.
function clientPolicy() {
  return {
    intent: {
      actions: ACTION_NAMES,
      precedence: [...PRECEDENCE],
      // Whether the browser may consult the semantic tier at all. Off makes the interviewer
      // behave exactly as it did before this module existed — the rollback path.
      semanticEnabled: process.env.VOICE_SEMANTIC_INTENT !== "false",
      minConfidence: Number(process.env.VOICE_INTENT_MIN_CONFIDENCE || MIN_CONFIDENCE),
      maxMetaWords: Number(process.env.VOICE_INTENT_MAX_META_WORDS || MAX_META_WORDS),
      // Tier 1 is consulted on the INTERIM transcript so the reply is ready before the candidate
      // has finished — but not on the first syllable, or every answer would trigger a lookup.
      // Below this many words there is not enough to classify; past maxMetaWords it is an answer.
      minWordsForLookup: Number(process.env.VOICE_INTENT_MIN_WORDS || 2),
      // A semantic lookup that has not answered within this long is abandoned and the utterance is
      // treated as an answer. The interview never waits on this path: a slow classifier must
      // degrade to the old behaviour, not to a stalled turn.
      timeoutMs: Number(process.env.VOICE_INTENT_TIMEOUT_MS || 1200),
    },
  };
}

module.exports = {
  ACTIONS,
  ACTION_NAMES,
  TIER1_ACTIONS,
  PRECEDENCE,
  MIN_CONFIDENCE,
  MAX_META_WORDS,
  detectDeterministic,
  gateSemantic,
  literalResidue,
  clientPolicy,
};
