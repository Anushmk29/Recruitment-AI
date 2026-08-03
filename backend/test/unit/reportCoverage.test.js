// Evidence coverage matrix + session quality. Both are pure joins/derivations over
// already-scored data, so the whole contract is assertable offline — which is the
// point: nothing here may depend on a model call.
//
// What these lock down:
//   - "not tested" is a real state and never rounds into a pass (§3 rule 5)
//   - a single contradiction is never averaged away by a sibling probe (§3 rule 4)
//   - criterion LABELS reach the recruiter, never raw ids like "c5"
//   - a degraded audio session suppresses the recommendation (§3 rule 5/6)

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildCoverageMatrix, computeSessionQuality, analyseTurnQuality, CELL } = require("../../utils/interviewReportEngine");
const { buildReportPdf } = require("../../services/interviewReportPdf");

const findings = [
  { criterionId: "c1", label: "Proficiency in MERN stack", kind: "must_have", weight: 0.4, status: "satisfied", supportingClaimIds: ["k1"] },
  { criterionId: "c2", label: "Knowledge of secure authentication", kind: "must_have", weight: 0.35, status: "absent", supportingClaimIds: [] },
  { criterionId: "c3", label: "Experience with Redux Toolkit", kind: "nice_to_have", weight: 0.25, status: "partial", supportingClaimIds: ["k3"] },
];

test("rows carry the criterion LABEL, not the raw id, and sort heaviest first", () => {
  const m = buildCoverageMatrix({ criterionFindings: findings, perCriterion: [], probes: [] });
  assert.deepEqual(
    m.rows.map((r) => r.label),
    ["Proficiency in MERN stack", "Knowledge of secure authentication", "Experience with Redux Toolkit"]
  );
  // The whole reason this exists: no bare "cN" may reach a recruiter.
  assert.ok(m.rows.every((r) => r.label !== r.criterionId));
});

test("an untested criterion is untested — never a pass", () => {
  const m = buildCoverageMatrix({ criterionFindings: findings, perCriterion: [], probes: [] });
  for (const row of m.rows) {
    assert.equal(row.assessment, CELL.untested);
    assert.equal(row.interview, CELL.untested);
    assert.equal(row.bucket, "insufficient");
  }
  // Nothing was tested → the full weight of the role is unspeakable-to.
  assert.equal(m.totals.insufficientWeight, 1);
  assert.equal(m.totals.provenWeight, 0);
  assert.equal(m.totals.failedWeight, 0);
});

// The point of the rebuild: a thin slice of a small paper cannot support a
// verdict, and saying so is a statement about our test, not the candidate.
test("1-of-3 items is NOT a failure — too few items to tell a wrong answer from a guess", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [{ criterionId: "c1", correctCount: 1, itemCount: 3 }],
    probes: [],
  });
  const row = m.rows.find((r) => r.criterionId === "c1");
  assert.equal(row.bucket, "insufficient");
  assert.equal(row.underpowered, true);
  assert.equal(m.totals.underpoweredCriteria, 1);
});

test("a decisive slice of adequate size can still fail", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [{ criterionId: "c1", correctCount: 1, itemCount: 8 }],
    probes: [],
  });
  assert.equal(m.rows.find((r) => r.criterionId === "c1").bucket, "failed");
});

test("all-correct on at least three items is proven", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [
      { criterionId: "c1", correctCount: 3, itemCount: 3 },
      { criterionId: "c2", correctCount: 2, itemCount: 2 },
    ],
    probes: [],
  });
  const by = Object.fromEntries(m.rows.map((r) => [r.criterionId, r]));
  assert.equal(by.c1.bucket, "proven");
  // Two items is below the floor even when both are right.
  assert.equal(by.c2.bucket, "insufficient");
});

test("a live probe verdict outranks the item ratio in both directions", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [
      { criterionId: "c1", correctCount: 3, itemCount: 3 },
      { criterionId: "c2", correctCount: 0, itemCount: 6 },
    ],
    probes: [
      { criterionId: "c1", verdict: "contradicted", question: "q", answerQuote: "No. No. No.", turnIndex: 29 },
      { criterionId: "c2", verdict: "verified", question: "q2", answerQuote: "yes, using JWT rotation", turnIndex: 4 },
    ],
  });
  const by = Object.fromEntries(m.rows.map((r) => [r.criterionId, r]));
  assert.equal(by.c1.bucket, "failed", "a contradicting exchange beats a clean item sweep");
  assert.equal(by.c2.bucket, "proven", "a verifying exchange beats a bad item sweep");
  // The exchange that drove the call travels with the row so it can be read.
  assert.equal(by.c1.decidingProbe.answerQuote, "No. No. No.");
  assert.equal(by.c1.decidingProbe.turnIndex, 29);
});

test("bucket weights are exhaustive — every criterion lands in exactly one", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [{ criterionId: "c1", correctCount: 3, itemCount: 3 }],
    probes: [{ criterionId: "c2", verdict: "contradicted" }],
  });
  const counted = m.buckets.proven.rows.length + m.buckets.failed.rows.length + m.buckets.insufficient.rows.length;
  assert.equal(counted, m.rows.length);
  const w = m.totals.provenWeight + m.totals.failedWeight + m.totals.insufficientWeight;
  assert.ok(Math.abs(w - 1) < 0.02, `bucket weights should sum to the rubric, got ${w}`);
});

test("every row carries a plain-language evidence line", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [{ criterionId: "c1", correctCount: 2, itemCount: 4 }],
    probes: [],
  });
  const row = m.rows.find((r) => r.criterionId === "c1");
  assert.equal(row.evidence, "2 of 4 assessment items · never probed in the interview");
});

test("a claim that was never made reads as 'not claimed', not as a failure", () => {
  const m = buildCoverageMatrix({ criterionFindings: findings, perCriterion: [], probes: [] });
  const secure = m.rows.find((r) => r.criterionId === "c2");
  assert.equal(secure.claimed, false);
});

test("assessment ratios map coarsely and never round a 2/4 into a pass", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [
      { criterionId: "c1", correctCount: 4, itemCount: 4 },
      { criterionId: "c2", correctCount: 2, itemCount: 4 },
      { criterionId: "c3", correctCount: 0, itemCount: 3 },
    ],
    probes: [],
  });
  const by = Object.fromEntries(m.rows.map((r) => [r.criterionId, r]));
  assert.equal(by.c1.assessment, CELL.verified);
  assert.equal(by.c2.assessment, CELL.partial);
  assert.equal(by.c3.assessment, CELL.contradicted);
  assert.deepEqual(by.c2.assessmentDetail, { correctCount: 2, itemCount: 4 });
});

test("one contradicted probe outweighs a verified sibling — disagreement is not averaged", () => {
  const m = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [],
    probes: [
      { criterionId: "c1", verdict: "verified" },
      { criterionId: "c1", verdict: "contradicted" },
    ],
  });
  assert.equal(m.rows.find((r) => r.criterionId === "c1").interview, CELL.contradicted);
});

test("a probe with no verdict yet is untested, not inconclusive", () => {
  const m = buildCoverageMatrix({ criterionFindings: findings, perCriterion: [], probes: [{ criterionId: "c1", verdict: null }] });
  assert.equal(m.rows.find((r) => r.criterionId === "c1").interview, CELL.untested);
});

test("no rubric leg → null, so pre-existing reports render unchanged", () => {
  assert.equal(buildCoverageMatrix({ criterionFindings: [], perCriterion: [], probes: [] }), null);
  assert.equal(buildCoverageMatrix({}), null);
});

// --- session quality -------------------------------------------------------

const clean = [
  { role: "ai", text: "Tell me about your React experience." },
  {
    role: "candidate",
    text: "I built a dashboard in React using hooks and context for state, and memoised the expensive list rendering.",
    audioDurationMs: 22000,
    answerScore: 80,
    acoustic: { pauseRatio: 0.4, audioQuality:74 },
  },
];

test("a clean session is not flagged and keeps its recommendation", () => {
  const q = computeSessionQuality(clean);
  assert.equal(q.degraded, false);
  assert.equal(q.reasons.length, 0);
});

// Verbatim turns from the 31 Jul session, so the thresholds are held against the
// data that motivated them rather than against invented numbers.
test("the two genuinely attempted answers are NOT flagged", () => {
  const real = analyseTurnQuality([
    {
      role: "candidate",
      text: "For handling asynchronous actions in a Redux based AI chatbot, I would use Redux Toolkit createAsyncThunk as it simplifies async logic and automatically manages loading success and error states.",
      audioDurationMs: 55756,
      acoustic: { wordsPerMinute: 111, pauseRatio: 0.57, audioQuality:74 },
    },
    {
      role: "candidate",
      text: "For prompt engineering I add a persona, then assign it a task, then tell it what the output should look like.",
      audioDurationMs: 40841,
      acoustic: { wordsPerMinute: 125, pauseRatio: 0.56, audioQuality:71 },
    },
  ]);
  assert.deepEqual(real.map((t) => t.degraded), [false, false]);
});

test("long audio that transcribes to nothing is the stalled signature", () => {
  const [t] = analyseTurnQuality([
    { role: "candidate", text: "Hello?", audioDurationMs: 19045, acoustic: { wordsPerMinute: 3, pauseRatio: 0.83, audioQuality: 0 } },
  ]);
  assert.deepEqual(t.flags.sort(), ["mostly_silence", "stalled", "unusable_audio"]);
  assert.equal(t.degraded, true);
});

// Every flag on a turn describes the RECORDING. `unusable_audio` replaced a flag literally called
// `low_delivery`, rendered to recruiters as "very low delivery" — which reads as a verdict on the
// person when what it meant was that the microphone captured almost nothing. The distinction is
// the whole reason this measurement is still allowed to exist (see utils/prosody.js), so it is
// held here rather than left to whoever next edits the label.
test("turn flags describe the recording, never the candidate", () => {
  const [t] = analyseTurnQuality([
    { role: "candidate", text: "Hello?", audioDurationMs: 19045, acoustic: { wordsPerMinute: 3, pauseRatio: 0.9, audioQuality: 0 } },
  ]);
  assert.ok(!t.flags.includes("low_delivery"), "the old person-shaped flag name is gone");
  assert.equal(t.deliveryScore, undefined, "no per-turn delivery score is reported anywhere");
  // A fluent, fast, filler-free answer and a slow, hesitant one are both perfectly audible, and
  // must be indistinguishable to this code.
  const [fluent, hesitant] = analyseTurnQuality([
    { role: "candidate", text: "I led the Kafka migration across four services over about six months.", audioDurationMs: 12000, acoustic: { wordsPerMinute: 165, fillerRate: 0, pauseRatio: 0.2 } },
    { role: "candidate", text: "I led the Kafka migration across four services over about six months.", audioDurationMs: 30000, acoustic: { wordsPerMinute: 82, fillerRate: 22, pauseRatio: 0.5 } },
  ]);
  assert.deepEqual(fluent.flags, hesitant.flags, "pace and hesitation must not change a turn's flags");
  assert.equal(hesitant.degraded, false);
});

// A transcript recorded across a dropped socket is missing words, and the whole failure this
// guards against is that a hole looks exactly like a short answer. The candidate whose broadband
// dropped and the candidate who had nothing to say produce the same short paragraph; only this
// flag can tell a reviewer which one they are reading.
test("an answer recorded across a dropped connection is never a clean read", () => {
  const [t] = analyseTurnQuality([
    {
      role: "candidate",
      text: "We moved the ingestion pipeline onto Kafka over about four months.",
      audioDurationMs: 41000,
      acoustic: { wordsPerMinute: 120, pauseRatio: 0.35, audioQuality: 88 },
      connection: { drops: 1, gapMs: 5200 },
    },
  ]);
  // Everything else about this turn is healthy — good pace, clean audio, a real answer. The drop
  // is the ONLY thing wrong with it, so it is the only thing that can flag it.
  assert.deepEqual(t.flags, ["connection_dropped"]);
  assert.equal(t.degraded, true);
});

test("one dropped connection is enough to withhold the recommendation", () => {
  const q = computeSessionQuality([
    { role: "candidate", text: "A perfectly good answer about Kafka consumer groups and rebalancing.", audioDurationMs: 30000, acoustic: { wordsPerMinute: 130, pauseRatio: 0.3, audioQuality: 90 } },
    {
      role: "candidate",
      text: "The second answer, cut in half by the network.",
      audioDurationMs: 28000,
      acoustic: { wordsPerMinute: 118, pauseRatio: 0.32, audioQuality: 86 },
      connection: { drops: 1, gapMs: 7400 },
    },
  ]);
  // Not a ratio and not a threshold: a single known hole in the evidence is enough. Every other
  // degradation signature here is inferred from ambiguous audio, but this one is a recorded fact,
  // and there is no honest way to recommend against someone on a transcript we know is incomplete.
  assert.equal(q.droppedTurns, 1);
  assert.equal(q.degraded, true);
  assert.equal(q.suppressRecommendation, true);
  assert.ok(q.reasons.some((r) => /never recorded/i.test(r)));
});

test("a clean session records no connection trouble at all", () => {
  const q = computeSessionQuality([
    { role: "candidate", text: "A perfectly good answer about Kafka consumer groups and rebalancing.", audioDurationMs: 30000, acoustic: { wordsPerMinute: 130, pauseRatio: 0.3, audioQuality: 90 } },
  ]);
  assert.equal(q.droppedTurns, 0);
  assert.equal(q.suppressRecommendation, false);
});

// Sessions recorded before the rename stored the same measurement under `deliveryScore`. Their
// bad audio must still be flagged — the point of the change was to stop DISPLAYING the number as
// a judgement, not to lose the ability to say "we could not hear this answer".
test("a pre-rename session still flags its unusable audio", () => {
  const [t] = analyseTurnQuality([
    { role: "candidate", text: "Hello?", audioDurationMs: 19045, acoustic: { wordsPerMinute: 3, pauseRatio: 0.83, deliveryScore: 0 } },
  ]);
  assert.ok(t.flags.includes("unusable_audio"));
  assert.equal(t.degraded, true);
});

test("a rambling non-answer is stalled too — rate, not raw word count", () => {
  // 30 words over 38s reads as speech but is 48wpm of "could you repeat that".
  const [t] = analyseTurnQuality([
    {
      role: "candidate",
      text: "I would for an AI chatbot, I would structure the Redux Store Could you please con could you please repeat the question, please? Could you please repeat? Could you repeat that?",
      audioDurationMs: 38506,
      acoustic: { wordsPerMinute: 48, pauseRatio: 0.84, audioQuality:16 },
    },
  ]);
  assert.equal(t.degraded, true);
  assert.ok(t.flags.includes("mostly_silence"));
  assert.ok(t.flags.includes("asked_to_repeat"));
});

test("a broken audio path suppresses the recommendation rather than reporting a no-hire", () => {
  // The real shape of the 31 Jul session: long recordings, no words, repeat requests.
  const turns = [
    { role: "candidate", text: "Hello?", audioDurationMs: 19045, acoustic: { wordsPerMinute: 3, pauseRatio: 0.83, audioQuality:0 } },
    {
      role: "candidate",
      text: "Could you please repeat that?",
      audioDurationMs: 38506,
      acoustic: { wordsPerMinute: 8, pauseRatio: 0.84, audioQuality:16 },
    },
    {
      role: "candidate",
      text: "Sorry. Can you repeat that again?",
      audioDurationMs: 25026,
      acoustic: { wordsPerMinute: 34, pauseRatio: 0.88, audioQuality:3 },
    },
    { role: "candidate", text: "Nope", audioDurationMs: 3240, acoustic: { wordsPerMinute: 19, pauseRatio: 0.97, audioQuality:0 } },
  ];
  const q = computeSessionQuality(turns);
  assert.equal(q.degraded, true);
  assert.equal(q.suppressRecommendation, true);
  assert.equal(q.repeatRequests, 2);
  assert.ok(q.reasons.some((r) => /repeated/i.test(r)));
  assert.ok(q.reasons.some((r) => /almost no words/i.test(r)));
});

test("an empty interview is not retroactively called degraded", () => {
  const q = computeSessionQuality([]);
  assert.equal(q.degraded, false);
  assert.equal(q.total, 0);
});

// --- PDF parity ------------------------------------------------------------

function reportWith(extra) {
  return {
    candidate: { name: "Ada Lovelace", email: "ada@example.com" },
    job: { title: "Junior MERN Stack Developer" },
    stage: "ai_interview_completed",
    stageLabel: "AI interview completed",
    hasInterview: false,
    assessment: null,
    ...extra,
  };
}

test("the PDF renders the coverage groups without an interview", () => {
  const coverage = buildCoverageMatrix({
    criterionFindings: findings,
    perCriterion: [{ criterionId: "c1", correctCount: 3, itemCount: 3 }],
    probes: [],
  });
  const pdf = buildReportPdf(reportWith({ coverage: { ...coverage, rubricVersion: 2 } }));
  assert.ok(Buffer.isBuffer(pdf) && pdf.length > 0);
  const text = pdf.toString("latin1");
  assert.ok(text.includes("What We Actually Know"));
  assert.ok(text.includes("PROVEN"));
  assert.ok(text.includes("TOO LITTLE EVIDENCE"));
});

test("the PDF prints criterion labels, never raw ids", () => {
  const coverage = buildCoverageMatrix({ criterionFindings: findings, perCriterion: [], probes: [] });
  const pdf = buildReportPdf(
    reportWith({
      coverage,
      assessment: {
        decision: { action: "sent" },
        session: {
          status: "completed",
          result: {
            scoredAt: new Date("2026-07-31T17:53:58Z"),
            totalItems: 4,
            totalCorrect: 3,
            perCriterion: [{ criterionId: "c1", correctCount: 3, itemCount: 4 }],
            claimVerdicts: [],
          },
        },
      },
    })
  );
  const text = pdf.toString("latin1");
  assert.ok(text.includes("Proficiency in MERN stack"), "expected the criterion label in the PDF");
});

test("the PDF states a withheld recommendation instead of printing a decision", () => {
  const pdf = buildReportPdf(
    reportWith({
      hasInterview: true,
      coverage: null,
      interview: {
        status: "completed",
        engine: "ai",
        questionCount: 4,
        transcript: [],
        evaluation: null,
        sessionQuality: computeSessionQuality([
          { role: "candidate", text: "Hello?", audioDurationMs: 19045, acoustic: { pauseRatio: 0.9, audioQuality:0 } },
          { role: "candidate", text: "Sorry, can you repeat that?", audioDurationMs: 25026, acoustic: { pauseRatio: 0.88, audioQuality:3 } },
          { role: "candidate", text: "Could you repeat the question please?", audioDurationMs: 30000, acoustic: { pauseRatio: 0.9, audioQuality:2 } },
        ]),
        recommendedAction: { action: "Re-interview", justification: "withheld", suppressed: true },
      },
    })
  );
  const text = pdf.toString("latin1");
  assert.ok(text.includes("Recommendation withheld"));
  assert.ok(text.includes("DEGRADED SESSION"));
});
