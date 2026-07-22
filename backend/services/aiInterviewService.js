// AI Interview Engine orchestration (Module 9, text-first). Drives a turn-based
// adaptive interview: load context → plan → ask → score+adapt → next → evaluate.
//
// Hardening (W3/W4):
//   - Per-tenant config (model/temperature/budget) from CompanySettings.
//   - Every LLM call is metered (usageService) for cost attribution + audit.
//   - The external LLM is used ONLY when: a key is configured, the candidate consented
//     (if the tenant requires it), and the tenant is under budget. Otherwise the local
//     deterministic engine runs — no PII leaves the system and no spend is incurred.
//   - The final evaluation runs OFF the candidate's request path (detached), so the last
//     answer submission returns immediately.
//   - The deterministic fallback NEVER emits an adverse recommendation (routes to "review").
//   - Evaluation is bias-blinded (no candidate name) and carries full provenance.

const Candidate = require("../models/Candidate");
const CompanySettings = require("../models/CompanySettings");
const llm = require("./llmService");
const usageService = require("./usageService");
const tenantContext = require("../utils/tenantContext");
const { applyTransition } = require("./pipelineService");
const { notifyAdmin } = require("./notificationService");
const { scoreDelivery, aggregateVoiceScores } = require("../utils/prosody");
const { isResponsive, wordCount } = require("../utils/interviewReportEngine");
const {
  PROMPT_VERSION,
  INTERVIEWER_SYSTEM,
  buildContext,
  PLAN_SCHEMA,
  planPrompt,
  QUESTION_SCHEMA,
  questionPrompt,
  EVALUATION_SCHEMA,
  evaluationPrompt,
} = require("../utils/interviewPrompts");

const PROVIDER = "openrouter";
const MAX_ANSWER_CHARS = 4000;

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

async function loadRefs(session) {
  const candidate = await Candidate.findById(session.candidate).populate("job");
  if (!candidate) throw Object.assign(new Error("Candidate not found for interview"), { status: 404 });
  const job = candidate.job;
  if (!job) throw Object.assign(new Error("Job not found for interview"), { status: 404 });
  return { candidate, job };
}

function loadSettings(companyId) {
  return CompanySettings.findOne({ company: companyId }).select("ai compliance");
}

// Whether the external LLM may process this candidate's data. Consent is required by
// default; a tenant can waive the requirement via compliance.aiConsentRequired=false.
function consentOk(candidate, settings) {
  const required = settings?.compliance?.aiConsentRequired !== false;
  if (!required) return true;
  return Boolean(candidate?.consent?.aiProcessing);
}

// Gate: is the real AI engine allowed for this call right now?
async function aiUsable(session, candidate, settings) {
  if (!llm.isEnabled()) return false;
  if (!consentOk(candidate, settings)) return false;
  try {
    if (await usageService.isOverBudget(session.company, settings?.ai)) {
      console.warn(`[aiInterview] company ${session.company} over LLM budget — using fallback`);
      return false;
    }
  } catch (err) {
    // Metering failure must not block interviews — fail open on the budget check.
    console.error("[aiInterview] budget check failed, proceeding:", err.message);
  }
  return true;
}

// ---- Deterministic fallbacks (no key / no consent / over budget) ----
function fallbackPlan(job) {
  const years = job.minExperienceYears || 0;
  const difficulty = years >= 5 ? "hard" : years >= 2 ? "medium" : "easy";
  const topics = job.requiredSkills && job.requiredSkills.length ? job.requiredSkills.slice(0, 6) : ["fundamentals", "projects", "problem solving"];
  return {
    role: job.title,
    difficultyEstimate: difficulty,
    topics,
    focusAreas: (job.requiredSkills || []).slice(0, 3),
    summary: `Screening interview for ${job.title}, targeting ${difficulty} difficulty.`,
  };
}

const GENERIC_QUESTIONS = [
  "Tell me about a project you're most proud of and your specific role in it.",
  "Walk me through the architecture of one system you built. What were the main trade-offs?",
  "How do you approach debugging a problem you've never seen before?",
  "Describe a time you had to learn a new technology quickly. How did you do it?",
  "What does 'good code' mean to you, and how do you make sure your work meets that bar?",
  "Tell me about a technical decision you disagreed with. How did you handle it?",
  "How would you go about improving the performance of a slow API endpoint?",
  "Describe how you'd design data storage for a feature with heavy read traffic.",
];

// Content-blind completeness heuristic (word count only) — this is NOT a judgement of
// correctness, only of whether the candidate engaged with the question at all. A
// non-responsive answer (too short / filler — see interviewReportEngine.isResponsive)
// must score near zero: it must never look like a borderline "review" score.
function fallbackAnswerScore(text) {
  const words = wordCount(text);
  if (!isResponsive(text)) return Math.min(15, words * 2);
  return Math.min(90, 20 + words * 2);
}

function fallbackQuestion({ ai, job }) {
  const asked = new Set(ai.askedQuestions);
  const skillQs = (job.requiredSkills || []).map(
    (s) => `Can you explain how you've used ${s} in practice, and a limitation you ran into with it?`
  );
  const pool = [...skillQs, ...GENERIC_QUESTIONS];
  const question = pool.find((q) => !asked.has(q)) || GENERIC_QUESTIONS[ai.questionCount % GENERIC_QUESTIONS.length];

  const lastAnswer = [...ai.turns].reverse().find((t) => t.role === "candidate");
  const answerScore = lastAnswer ? fallbackAnswerScore(lastAnswer.text) : 0;

  return { answerScore, difficulty: ai.currentDifficulty, topic: "general", question, isClosing: false };
}

// The fallback must NEVER produce an adverse hiring decision — it routes to human review.
function fallbackEvaluation(ai) {
  const answers = ai.turns.filter((t) => t.role === "candidate");
  const scored = answers.map((a) => (typeof a.answerScore === "number" ? a.answerScore : 55));
  const overall = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : 50;
  return {
    overallScore: overall,
    // The heuristic only measures answer completeness, never per-competency depth —
    // leaving these unset (rather than copying `overall` into all three) means the
    // report correctly shows "not measured" instead of three identical fake scores.
    communication: undefined,
    technicalKnowledge: undefined,
    problemSolving: undefined,
    strengths: [],
    weaknesses: [],
    missingSkills: [],
    recommendation: "review", // never strong_hire/hire/maybe/no_hire from a heuristic
    summary:
      "Automated evaluation is unavailable (AI provider not configured, consent not given, or budget exhausted). " +
      "These indicative scores come from answer-completeness heuristics and must NOT drive a hiring decision — a human should review the transcript.",
    generatedBy: "fallback",
    provider: null,
    model: null,
    promptVersion: null,
  };
}

// ---- LLM steps (metered, with graceful fallback) ----
async function makePlan({ session, candidate, job, settings, context, useAi }) {
  if (!useAi) return { plan: fallbackPlan(job), engine: "fallback" };
  const t0 = Date.now();
  try {
    const { data, usage, model } = await llm.generateJSON({
      system: INTERVIEWER_SYSTEM,
      prompt: planPrompt(context),
      schema: PLAN_SCHEMA,
      maxTokens: 640,
      model: settings?.ai?.model,
      temperature: settings?.ai?.temperature,
    });
    await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "plan", provider: PROVIDER, model, usage, latencyMs: Date.now() - t0, engine: "ai" });
    return { plan: data, engine: "ai" };
  } catch (err) {
    console.error("[aiInterview] plan generation failed, using fallback:", err.message);
    return { plan: fallbackPlan(job), engine: "fallback" };
  }
}

async function nextQuestion({ session, candidate, job, settings, ai, context, useAi }) {
  if (!useAi) return { ...fallbackQuestion({ ai, job }), engine: "fallback", model: null, latencyMs: 0 };
  const t0 = Date.now();
  try {
    const { data, usage, model } = await llm.generateJSON({
      system: INTERVIEWER_SYSTEM,
      prompt: questionPrompt({
        context,
        plan: ai.plan || {},
        turns: ai.turns,
        currentDifficulty: ai.currentDifficulty,
        askedQuestions: ai.askedQuestions,
        questionCount: ai.questionCount,
        maxQuestions: ai.maxQuestions,
      }),
      schema: QUESTION_SCHEMA,
      maxTokens: 512,
      model: settings?.ai?.model,
      temperature: settings?.ai?.temperature,
    });
    const latencyMs = Date.now() - t0;
    await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "question", provider: PROVIDER, model, usage, latencyMs, engine: "ai" });
    return { ...data, engine: "ai", model, latencyMs };
  } catch (err) {
    console.error("[aiInterview] question generation failed, using fallback:", err.message);
    return { ...fallbackQuestion({ ai, job }), engine: "fallback", model: null, latencyMs: Date.now() - t0 };
  }
}

async function makeEvaluation({ session, candidate, job, settings, ai, useAi }) {
  if (!useAi) return fallbackEvaluation(ai);
  const t0 = Date.now();
  try {
    // Bias-blinded context: the candidate's name is withheld from the scoring prompt.
    const blindContext = buildContext(candidate, job, { blind: true });
    const { data, usage, model } = await llm.generateJSON({
      system: INTERVIEWER_SYSTEM,
      prompt: evaluationPrompt({ context: blindContext, turns: ai.turns }),
      schema: EVALUATION_SCHEMA,
      maxTokens: 1024,
      model: settings?.ai?.model,
      temperature: settings?.ai?.temperature,
    });
    const latencyMs = Date.now() - t0;
    await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "evaluation", provider: PROVIDER, model, usage, latencyMs, engine: "ai" });
    return {
      ...data,
      generatedBy: "ai",
      provider: PROVIDER,
      model,
      promptVersion: PROMPT_VERSION,
      temperature: settings?.ai?.temperature ?? 0,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs,
    };
  } catch (err) {
    console.error("[aiInterview] evaluation failed, using fallback:", err.message);
    return fallbackEvaluation(ai);
  }
}

// Candidate-facing view of the interview (never exposes the evaluation or provenance).
function publicState(session) {
  const ai = session.aiInterview;
  const lastAi = [...ai.turns].reverse().find((t) => t.role === "ai");
  return {
    status: ai.status,
    engine: ai.engine,
    questionCount: ai.questionCount,
    maxQuestions: ai.maxQuestions,
    turns: ai.turns.map((t) => ({ role: t.role, kind: t.kind, text: t.text, at: t.at })),
    currentQuestion: ai.status === "in_progress" ? lastAi?.text || null : null,
    awaitingAnswer: ai.status === "in_progress",
    completed: ai.status === "completed",
  };
}

// Begin (or resume) the interview. Idempotent: safe to call on every load.
async function beginInterview(session) {
  const ai = session.aiInterview;
  if (ai.status !== "not_started") return publicState(session);

  const { candidate, job } = await loadRefs(session);
  const settings = await loadSettings(session.company);
  const context = buildContext(candidate, job);
  const useAi = await aiUsable(session, candidate, settings);

  const { plan, engine } = await makePlan({ session, candidate, job, settings, context, useAi });
  ai.plan = plan;
  ai.engine = useAi ? "ai" : "fallback";
  ai.currentDifficulty = plan.difficultyEstimate || "medium";
  ai.status = "in_progress";
  ai.startedAt = new Date();

  ai.turns.push({
    role: "ai",
    kind: "intro",
    text: `Hi ${candidate.basicDetails.name.split(" ")[0]}, thanks for joining. I'll ask you a few questions about your background and the ${job.title} role. Take your time, and let's get started.`,
  });

  const first = await nextQuestion({ session, candidate, job, settings, ai, context, useAi });
  ai.turns.push({ role: "ai", kind: "question", text: first.question, topic: first.topic, difficulty: first.difficulty, engine: first.engine, model: first.model, latencyMs: first.latencyMs });
  ai.askedQuestions.push(first.question);
  ai.questionCount = 1;

  await session.save();
  return publicState(session);
}

// Record the candidate's answer and either ask the next question or complete. `opts` carries
// optional voice metadata (inputMode/transcriptConfidence/audioDurationMs/acoustic) for spoken
// answers — the transcript itself is `answerText`, so the downstream LLM path is unchanged.
async function submitAnswer(session, answerText, opts = {}) {
  const ai = session.aiInterview;
  if (ai.status !== "in_progress") {
    throw Object.assign(new Error("The interview is not in progress"), { status: 400 });
  }
  const text = String(answerText || "").trim().slice(0, MAX_ANSWER_CHARS);
  if (!text) throw Object.assign(new Error("An answer is required"), { status: 400 });

  const answerTurn = { role: "candidate", kind: "answer", text, inputMode: opts.inputMode === "voice" ? "voice" : "text" };
  if (opts.inputMode === "voice") {
    ai.modality = "voice";
    if (opts.transcriptConfidence !== undefined) answerTurn.transcriptConfidence = opts.transcriptConfidence;
    if (opts.audioDurationMs !== undefined) answerTurn.audioDurationMs = opts.audioDurationMs;
    if (opts.acoustic) {
      // Derive the per-answer delivery score server-side (never trust a client-sent score).
      answerTurn.acoustic = { ...opts.acoustic, deliveryScore: scoreDelivery(opts.acoustic) };
    }
  }
  ai.turns.push(answerTurn);

  const { candidate, job } = await loadRefs(session);
  const settings = await loadSettings(session.company);
  const context = buildContext(candidate, job);
  const useAi = await aiUsable(session, candidate, settings);

  if (ai.questionCount >= ai.maxQuestions) {
    ai.turns.push({ role: "ai", kind: "closing", text: "That's everything I wanted to cover — thank you for your time. Your responses have been recorded and the team will be in touch." });
    ai.status = "completed";
    ai.completedAt = new Date();
    session.status = "completed";
    session.completedAt = new Date();
    await session.save();
    // Run the slow evaluation OFF the request path so the candidate's final submit
    // returns immediately; failure is contained and logged.
    scheduleFinalization(session._id);
    return publicState(session);
  }

  const next = await nextQuestion({ session, candidate, job, settings, ai, context, useAi });
  const lastAnswer = [...ai.turns].reverse().find((t) => t.role === "candidate");
  const score = clampScore(next.answerScore);
  if (lastAnswer && score !== undefined) lastAnswer.answerScore = score;
  if (next.difficulty) ai.currentDifficulty = next.difficulty;

  ai.turns.push({ role: "ai", kind: "question", text: next.question, topic: next.topic, difficulty: next.difficulty, engine: next.engine, model: next.model, latencyMs: next.latencyMs });
  ai.askedQuestions.push(next.question);
  ai.questionCount += 1;

  await session.save();
  return publicState(session);
}

// Detached: decouple the (slow, high-token) evaluation from the candidate's HTTP request.
function scheduleFinalization(sessionId) {
  setImmediate(() => {
    tenantContext
      .runAsSystem(() => runFinalization(sessionId))
      .catch((err) => console.error("[aiInterview] finalization failed:", err.message));
  });
}

async function runFinalization(sessionId) {
  const InterviewSession = require("../models/InterviewSession");
  const session = await InterviewSession.findById(sessionId);
  if (!session) return;
  const ai = session.aiInterview;
  if (ai.evaluation && ai.evaluation.generatedAt) return; // already finalized (idempotent)

  const { candidate, job } = await loadRefs(session);
  const settings = await loadSettings(session.company);
  const useAi = await aiUsable(session, candidate, settings);

  const evaluation = await makeEvaluation({ session, candidate, job, settings, ai, useAi });
  // Voice interviews get delivery + confidence scores derived from the answers' prosody
  // (content is scored by the LLM; how it was spoken is measured, not guessed).
  const voice = aggregateVoiceScores(ai.turns);
  if (voice) {
    if (voice.delivery !== undefined) evaluation.delivery = voice.delivery;
    if (voice.confidence !== undefined) evaluation.confidence = voice.confidence;
  }
  ai.evaluation = { ...evaluation, generatedAt: new Date() };
  await session.save();

  // Advance the pipeline stage (guarded) — a transition error never blocks completion.
  try {
    const candidateDoc = await Candidate.findById(session.candidate).populate("job", "title");
    if (candidateDoc && candidateDoc.status === "interview_scheduled") {
      await applyTransition(candidateDoc, "ai_interview_completed", { actorName: "AI Interviewer" });
    }
  } catch (err) {
    console.error("[aiInterview] stage transition to ai_interview_completed failed:", err.message);
  }

  try {
    await notifyAdmin({
      companyId: session.company,
      type: "ai_report_ready",
      title: "AI interview report ready",
      message: `${candidate.basicDetails.name}'s AI interview for ${job.title} is complete. Overall score: ${ai.evaluation.overallScore}${ai.evaluation.recommendation === "review" ? " (needs human review)" : ""}.`,
      meta: { candidateId: candidate._id, sessionId: session._id, score: ai.evaluation.overallScore, recommendation: ai.evaluation.recommendation },
    });
  } catch (err) {
    console.error("[aiInterview] admin notification failed:", err.message);
  }
}

module.exports = { beginInterview, submitAnswer, publicState };
