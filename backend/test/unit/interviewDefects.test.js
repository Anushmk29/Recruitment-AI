// Phase 9 acceptance gates — interview engine defects:
//   9.1 the FINAL answer is scored (finalisation scores any unscored answer,
//       AI path and fallback path both);
//   9.2 the fallback evaluation never fabricates 55 for unscored answers —
//       unscored answers are excluded, and with nothing scored the overall is
//       null ("not measured"), never a number;
//   9.4 voice STT/TTS cost estimation is deterministic and sane;
//   9.5 the voice token endpoint hard-refuses without recorded consent;
//   9.6 the dead audioPath field is gone; voiceConsent exists.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const aiInterview = require("../../services/aiInterviewService");
const llm = require("../../services/llmService");
const usageService = require("../../services/usageService");
const speech = require("../../services/speechService");
const portal = require("../../controllers/interviewPortalController");
const InterviewSession = require("../../models/InterviewSession");

function refs() {
  return {
    session: { _id: new mongoose.Types.ObjectId(), company: new mongoose.Types.ObjectId() },
    candidate: {
      _id: new mongoose.Types.ObjectId(),
      basicDetails: { name: "Test Candidate", email: "t@example.com" },
      skills: ["node.js"],
      experience: [],
      education: [],
      projects: [],
      ats: {},
    },
    job: { title: "Backend Engineer", description: "Build APIs", requiredSkills: ["node.js"], minExperienceYears: 2 },
  };
}

function turnsWithUnscoredFinal() {
  return [
    { role: "ai", kind: "intro", text: "Hi" },
    { role: "ai", kind: "question", text: "Q1?" },
    { role: "candidate", kind: "answer", text: "A thorough answer about building REST APIs with Express and error handling middleware.", answerScore: 70 },
    { role: "ai", kind: "question", text: "Q2 — the final question?" },
    { role: "candidate", kind: "answer", text: "Another substantive answer describing MongoDB schema design decisions and their trade-offs in production." },
    { role: "ai", kind: "closing", text: "Thanks!" },
  ];
}

// ---------------------------------------------------------------------------
// 9.1 — the final answer is scored
// ---------------------------------------------------------------------------

test("ACCEPTANCE GATE 9.1: finalisation scores the final answer (fallback path)", async () => {
  const { session, candidate, job } = refs();
  const ai = { turns: turnsWithUnscoredFinal() };
  await aiInterview.scoreUnscoredAnswers({ session, candidate, job, settings: null, ai, useAi: false });
  const final = ai.turns[4];
  assert.equal(typeof final.answerScore, "number", "the final answer must now carry a score");
  assert.ok(final.answerScore > 0, "a substantive answer scores above zero");
  assert.equal(ai.turns[2].answerScore, 70, "already-scored answers are untouched");
});

test("ACCEPTANCE GATE 9.1: finalisation scores the final answer (AI path, metered)", async () => {
  const { session, candidate, job } = refs();
  const ai = { turns: turnsWithUnscoredFinal() };

  const origGen = llm.generateJSON;
  const origRec = usageService.recordUsage;
  const calls = [];
  llm.generateJSON = async (req) => {
    calls.push(req);
    assert.ok(req.prompt.includes("Q2 — the final question?"), "the scoring prompt carries the actual question");
    assert.ok(!req.prompt.includes("Test Candidate"), "late scoring is bias-blinded (no candidate name)");
    return { data: { answerScore: 84 }, usage: { promptTokens: 10, completionTokens: 2 }, model: "stub", cached: false };
  };
  const metered = [];
  usageService.recordUsage = async (row) => metered.push(row);
  try {
    await aiInterview.scoreUnscoredAnswers({ session, candidate, job, settings: null, ai, useAi: true });
  } finally {
    llm.generateJSON = origGen;
    usageService.recordUsage = origRec;
  }
  assert.equal(ai.turns[4].answerScore, 84);
  assert.equal(calls.length, 1, "only the unscored answer triggers a call");
  assert.equal(metered.length, 1);
  assert.equal(metered[0].kind, "evaluation");
});

test("9.1: a failed scoring call leaves the answer honestly unscored (no invented number)", async () => {
  const { session, candidate, job } = refs();
  const ai = { turns: turnsWithUnscoredFinal() };
  const origGen = llm.generateJSON;
  llm.generateJSON = async () => {
    throw new Error("provider down");
  };
  const origRec = usageService.recordUsage;
  usageService.recordUsage = async () => {};
  try {
    await aiInterview.scoreUnscoredAnswers({ session, candidate, job, settings: null, ai, useAi: true });
  } finally {
    llm.generateJSON = origGen;
    usageService.recordUsage = origRec;
  }
  assert.equal(ai.turns[4].answerScore, undefined);
});

// ---------------------------------------------------------------------------
// 9.2 — the fallback never fabricates 55
// ---------------------------------------------------------------------------

test("ACCEPTANCE GATE 9.2: unscored answers are EXCLUDED from the fallback mean", () => {
  const ai = {
    turns: [
      { role: "candidate", kind: "answer", text: "x", answerScore: 80 },
      { role: "candidate", kind: "answer", text: "y" }, // unscored — used to count as 55
      { role: "candidate", kind: "answer", text: "z", answerScore: 60 },
    ],
  };
  const ev = aiInterview.fallbackEvaluation(ai);
  assert.equal(ev.overallScore, 70, "mean over the two scored answers only — no fabricated 55");
  assert.equal(ev.recommendation, "review");
});

test("ACCEPTANCE GATE 9.2: with nothing scored the fallback reports null, not a number", () => {
  const ai = { turns: [{ role: "candidate", kind: "answer", text: "y" }] };
  const ev = aiInterview.fallbackEvaluation(ai);
  assert.equal(ev.overallScore, null);
  assert.ok(/No answers were scored/.test(ev.summary), "the summary states nothing was measured");
  assert.equal(ev.recommendation, "review", "the fallback never emits an adverse recommendation");
});

// ---------------------------------------------------------------------------
// 9.4 — voice cost estimation
// ---------------------------------------------------------------------------

test("9.4: STT/TTS cost estimates are deterministic and proportional", () => {
  assert.equal(speech.ttsCostCents(1000), 1.5);
  assert.equal(speech.ttsCostCents(0), 0);
  assert.equal(speech.sttCostCents(60000), 0.77);
  assert.equal(speech.sttCostCents(0), 0);
  assert.ok(speech.sttCostCents(120000) > speech.sttCostCents(60000));
});

// ---------------------------------------------------------------------------
// 9.5 — voice consent gates the streaming token server-side
// ---------------------------------------------------------------------------

function fakeRes() {
  const out = { statusCode: 200, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(x) {
      out.body = x;
    },
  };
}

test("ACCEPTANCE GATE 9.5: no consent ⇒ no streaming token (403, machine-readable)", async () => {
  const origEnabled = speech.isEnabled;
  speech.isEnabled = () => true;
  try {
    const res = fakeRes();
    await portal.voiceToken({ interviewSession: { voiceConsent: { given: false } } }, res);
    assert.equal(res.out.statusCode, 403);
    assert.equal(res.out.body.code, "VOICE_CONSENT_REQUIRED");
  } finally {
    speech.isEnabled = origEnabled;
  }
});

test("9.5: the session records given/declined voice consent shapes", () => {
  const vc = InterviewSession.schema.path("voiceConsent.given");
  assert.ok(vc, "voiceConsent.given exists on the session schema");
  assert.ok(InterviewSession.schema.path("voiceConsent.declined"));
});

// ---------------------------------------------------------------------------
// 9.6 — audioPath is gone
// ---------------------------------------------------------------------------

test("ACCEPTANCE GATE 9.6: the dead audioPath field no longer exists on interview turns", () => {
  const turnSchema = InterviewSession.schema.path("aiInterview").schema.path("turns").schema;
  assert.equal(turnSchema.path("audioPath"), undefined);
  assert.ok(turnSchema.path("audioDurationMs"), "the used voice metadata fields remain");
});
