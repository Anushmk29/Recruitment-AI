// Acceptance gates for the interruptible, context-reading interviewer.
//
// Three mechanisms are pinned down here, and each one is allowed to fail in exactly one direction:
//
//   1. utils/echoAlignment — the interviewer must not mistake its own voice for the candidate
//      (which truncates a question and corrupts probe coverage), and must not explain away a real
//      interruption. Ambiguity resolves to echo, so barge-in requires positive evidence.
//   2. utils/conversationIntent — understanding is open-ended, consequences are closed. Nothing
//      the semantic tier returns may reach an action outside the declared set, and everything
//      uncertain lands on "they were answering the question".
//   3. utils/metaAnswers — the interviewer answers questions about the interview from this
//      session's real state, never from a guess, and never says anything about the candidate.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const echo = require("../../utils/echoAlignment");
const conversationIntent = require("../../utils/conversationIntent");
const metaAnswers = require("../../utils/metaAnswers");
const backchannel = require("../../utils/backchannel");

const QUESTION =
  "Tell me about the Kafka migration you led at Zeta, and what your specific role was on that team.";

// ---------------------------------------------------------------------------
// 1. Echo alignment
// ---------------------------------------------------------------------------

test("1.1: the interviewer hearing itself is not treated as the candidate speaking", () => {
  const r = echo.classify("and what your specific role was on that team", {
    spokenText: QUESTION,
    spokenRatio: 1,
  });
  assert.equal(r.verdict, "echo");
  assert.equal(r.residue, "", "nothing of the candidate's is left behind to become their answer");
});

test("1.2: a real interruption is heard even when the echo tail is longer than it", () => {
  // The case a percentage-based rule gets wrong: at the instant of a barge-in the transcript is
  // mostly our own sentence, and the candidate's first words are the minority of it.
  const r = echo.classify("you led at zeta sorry can I stop you there", {
    spokenText: QUESTION,
    spokenRatio: 1,
  });
  assert.equal(r.verdict, "speech");
  assert.equal(r.residue, "sorry can i stop you there", "their turn starts with what they said");
});

test("1.3: a candidate quoting the question back is not mistaken for echo", () => {
  const said =
    "you asked about the kafka migration the kafka migration was the second thing we did that year";
  const r = echo.classify(said, { spokenText: QUESTION, spokenRatio: 1 });
  assert.equal(r.verdict, "speech");
});

test("1.4: single shared words are coincidence, not evidence of speech", () => {
  // Almost every sentence shares "that"/"and"/"the" with every other. If one word could count as
  // novel speech, our own echo would trigger barge-in constantly.
  const r = echo.classify("that", { spokenText: QUESTION, spokenRatio: 1 });
  assert.equal(r.verdict, "echo");
});

test("1.5: ordinary transcription error does not turn echo into a false interruption", () => {
  // "role" heard as "rule" — one wrong token inside an otherwise verbatim reproduction.
  const r = echo.classify("and what your specific rule was on that team", {
    spokenText: QUESTION,
    spokenRatio: 1,
  });
  assert.equal(r.verdict, "echo");
});

test("1.6: when nothing is being spoken, everything heard is the candidate", () => {
  const r = echo.classify("we ran three brokers", { spokenText: "" });
  assert.equal(r.verdict, "speech");
  assert.equal(r.reason, "nothing_being_spoken");
  assert.equal(r.residue, "we ran three brokers", "their words are passed through untouched");
});

test("1.7: our text can only explain what has actually been played", () => {
  // The candidate says words that appear in the UNSPOKEN remainder of the question. Without the
  // playback bound those words would be explained away as echo of something never heard.
  const early = echo.classify("what your specific role", { spokenText: QUESTION, spokenRatio: 0.1 });
  assert.equal(early.verdict, "speech");
  const late = echo.classify("what your specific role", { spokenText: QUESTION, spokenRatio: 1 });
  assert.equal(late.verdict, "echo");
});

test("1.8: the same stretch of our sentence cannot explain two parts of a transcript", () => {
  // Guards the run-consumption loop: if the pool were not consumed, one "on that team" in our
  // question could account for the candidate saying it twice.
  const r = echo.classify("on that team on that team on that team", {
    spokenText: QUESTION,
    spokenRatio: 1,
  });
  assert.equal(r.verdict, "speech", "a repetition we only said once is the candidate talking");
});

test("1.9: barge-in is only possible while the interviewer is speaking", () => {
  const opts = { spokenText: QUESTION, spokenRatio: 1 };
  assert.equal(echo.isBargeIn("sorry can I stop you there", { ...opts, speaking: true }), true);
  assert.equal(echo.isBargeIn("sorry can I stop you there", { ...opts, speaking: false }), false);
});

test("1.10: full duplex has a kill switch, and it defaults on", () => {
  const prev = process.env.VOICE_FULL_DUPLEX;
  try {
    delete process.env.VOICE_FULL_DUPLEX;
    assert.equal(echo.clientPolicy().echo.fullDuplex, true);
    process.env.VOICE_FULL_DUPLEX = "false";
    assert.equal(echo.clientPolicy().echo.fullDuplex, false, "an open mic under our own voice must be revocable");
  } finally {
    if (prev === undefined) delete process.env.VOICE_FULL_DUPLEX;
    else process.env.VOICE_FULL_DUPLEX = prev;
  }
});

// ---------------------------------------------------------------------------
// 2. The intent layer
// ---------------------------------------------------------------------------

test("2.1: the deterministic tier answers the common phrasings without a model", () => {
  const r = conversationIntent.detectDeterministic("sorry, could you repeat that?");
  assert.equal(r.action, "repeat");
  assert.equal(r.tier, 0);
  assert.equal(r.confidence, 1);
});

test("2.2: asking for another go beats declining when both readings fit", () => {
  // "I'm not sure" is a decline trigger and "what was that" is a repeat trigger. A decline is
  // counted against evidence coverage, so reading this as one takes a question away from someone
  // who was still trying.
  const r = conversationIntent.detectDeterministic("i'm not sure, what was that?");
  assert.equal(r.action, "repeat");
});

test("2.3: precedence is stated, not incidental to which matcher ran first", () => {
  assert.equal(conversationIntent.PRECEDENCE[0], "withdraw", "the most consequential reading wins");
  assert.ok(
    conversationIntent.PRECEDENCE.indexOf("technical_problem") <
      conversationIntent.PRECEDENCE.indexOf("decline"),
    "a broken microphone is not an admission of not knowing"
  );
});

test("2.4: a phrase buried in a real answer is not an act", () => {
  const answer =
    "I don't know the exact number, but we ran three brokers and the lag never went above forty milliseconds";
  assert.equal(conversationIntent.detectDeterministic(answer), null, "this is evidence, not a decline");
});

test("2.5: every uncertainty in the semantic tier becomes 'they were answering'", () => {
  const cases = [
    [null, "no_classification"],
    [{ action: "delete_everything", confidence: 1 }, "unknown_action"],
    [{ action: "repeat", confidence: 0.4 }, "below_confidence"],
    [{ action: "repeat" }, "below_confidence"],
  ];
  for (const [raw, expectPrefix] of cases) {
    const r = conversationIntent.gateSemantic(raw, "sorry what");
    assert.equal(r.action, "answer_continues", `${JSON.stringify(raw)} must fall back`);
    assert.ok(r.reason.startsWith(expectPrefix), `${r.reason} should start with ${expectPrefix}`);
  }
});

test("2.6: the semantic tier cannot reach an action outside the closed set", () => {
  for (const action of conversationIntent.TIER1_ACTIONS) {
    assert.ok(conversationIntent.ACTIONS[action], `${action} must be a declared action`);
  }
  const r = conversationIntent.gateSemantic({ action: "hire_them", confidence: 1 }, "ok");
  assert.equal(r.action, "answer_continues");
});

test("2.7: a long utterance is an answer however it was classified", () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const r = conversationIntent.gateSemantic({ action: "decline", confidence: 0.99 }, long);
  assert.equal(r.action, "answer_continues");
  assert.equal(r.reason, "too_long_to_be_about_the_interview");
});

test("2.8: withdrawal always needs confirmation, whichever tier read it", () => {
  const tier0 = conversationIntent.detectDeterministic("i want to stop");
  assert.equal(tier0.action, "withdraw");
  assert.equal(tier0.needsConfirmation, true);
  const tier1 = conversationIntent.gateSemantic(
    { action: "withdraw", confidence: 1, reason: "they asked to leave" },
    "i think i'd like to leave now"
  );
  assert.equal(tier1.action, "withdraw");
  assert.equal(tier1.needsConfirmation, true, "understanding it perfectly is not a reason to skip the check");
});

test("2.9: a residue the model invented is discarded, not put into the candidate's answer", () => {
  const said = "sorry what was that";
  assert.equal(
    conversationIntent.literalResidue("I have ten years of Kubernetes experience", said),
    "",
    "words the candidate never said must never survive into their turn"
  );
  assert.equal(conversationIntent.literalResidue("what was that", said), "what was that");
});

test("2.10: only answer_continues leaves the turn as the candidate's answer", () => {
  for (const [name, def] of Object.entries(conversationIntent.ACTIONS)) {
    assert.equal(
      def.consumesTurn,
      name !== "answer_continues",
      `${name} must declare whether it is the candidate's answer`
    );
  }
});

test("2.11: the semantic tier is switchable off, back to the behaviour that shipped before it", () => {
  const prev = process.env.VOICE_SEMANTIC_INTENT;
  try {
    delete process.env.VOICE_SEMANTIC_INTENT;
    assert.equal(conversationIntent.clientPolicy().intent.semanticEnabled, true);
    process.env.VOICE_SEMANTIC_INTENT = "false";
    assert.equal(conversationIntent.clientPolicy().intent.semanticEnabled, false);
  } finally {
    if (prev === undefined) delete process.env.VOICE_SEMANTIC_INTENT;
    else process.env.VOICE_SEMANTIC_INTENT = prev;
  }
});

// ---------------------------------------------------------------------------
// 3. Answers to questions about the interview
// ---------------------------------------------------------------------------

test("3.1: 'how many more?' is answered from this interview's real numbers", () => {
  const a = metaAnswers.answerFor("how_many_left", { questionCount: 3, minQuestions: 5, maxQuestions: 8 });
  assert.equal(a.answered, true);
  assert.match(a.text, /2 and 5/, "a range, because the interview genuinely can close early");
});

test("3.2: the last question is described as the last question", () => {
  const a = metaAnswers.answerFor("how_many_left", { questionCount: 8, minQuestions: 5, maxQuestions: 8 });
  assert.equal(a.text, "This is the last one.");
});

test("3.3: an unknown monitoring state defers rather than guessing", () => {
  // The one topic where a confident wrong answer is a consent problem, not an inaccuracy.
  const unknown = metaAnswers.answerFor("is_recorded", {});
  assert.equal(unknown.answered, false);
  assert.equal(unknown.text, metaAnswers.DEFERRAL);

  const monitored = metaAnswers.answerFor("is_recorded", { proctoringEnabled: true });
  assert.match(monitored.text, /monitored/);
  const not = metaAnswers.answerFor("is_recorded", { proctoringEnabled: false });
  assert.doesNotMatch(not.text, /this session is monitored/);
});

test("3.4: a question we are not the right party to answer is declined plainly", () => {
  const a = metaAnswers.answerFor("what_is_the_salary", {});
  assert.equal(a.answered, false);
  assert.equal(a.topic, null);
  assert.equal(a.text, metaAnswers.DEFERRAL);
});

test("3.5: no answer about the interview ever rates the candidate", () => {
  // The boot check enforces this at require time; this asserts it stays enforced, and covers the
  // deferral and every state branch rather than the single sample the boot check uses.
  const states = [
    { questionCount: 0, minQuestions: 5, maxQuestions: 8, proctoringEnabled: true },
    { questionCount: 7, minQuestions: 5, maxQuestions: 8, proctoringEnabled: false },
    { questionCount: 8, minQuestions: 8, maxQuestions: 8 },
  ];
  for (const state of states) {
    for (const topic of metaAnswers.TOPIC_NAMES) {
      const { text } = metaAnswers.answerFor(topic, state);
      const offender = backchannel.findEvaluativeWord(text);
      assert.equal(offender, null, `"${text}" (${topic}) rates the candidate via "${offender}"`);
    }
  }
  assert.equal(backchannel.findEvaluativeWord(metaAnswers.DEFERRAL), null);
});

test("3.6: 'how am I doing?' has no answer here at all", () => {
  // Deliberately absent from the table: it is an assessment delivered to the candidate
  // mid-interview with no human in the loop, and it varies with their performance.
  assert.ok(!metaAnswers.TOPIC_NAMES.includes("how_am_i_doing"));
  assert.equal(metaAnswers.answerFor("how_am_i_doing", {}).text, metaAnswers.DEFERRAL);
});

test("3.7: a malformed state costs the candidate a fact, never a reply", () => {
  const a = metaAnswers.answerFor("how_many_left", { maxQuestions: "not a number" });
  assert.equal(a.answered, false);
  assert.ok(a.text.length > 0, "they always get an answer of some kind");
});

// ---------------------------------------------------------------------------
// 4. The reply bank grew — and the guarantees on it did not weaken
// ---------------------------------------------------------------------------

test("4.1: the new reply banks exist and reach the browser", () => {
  const policy = backchannel.clientPolicy();
  assert.ok(policy.clarifyPreambles.length, "clarify must have approved phrasing");
  assert.ok(policy.technicalReplies.length, "a broken microphone must have an approved reply");
});

test("4.2: every phrase in the bank is still non-evaluative, including the new ones", () => {
  for (const phrase of backchannel.allPhrases()) {
    assert.equal(
      backchannel.findEvaluativeWord(phrase),
      null,
      `"${phrase}" signals how well the candidate did`
    );
  }
});

test("4.3: clarify and repeat are different things and say different things", () => {
  // The whole point of the clarify path: someone who did not understand is not helped by hearing
  // the identical sentence again.
  const repeat = backchannel.phrases("repeat");
  const clarify = backchannel.phrases("clarify");
  for (const c of clarify) assert.ok(!repeat.includes(c), `"${c}" must not be shared with repeat`);
});
