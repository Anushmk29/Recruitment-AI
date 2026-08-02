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
const { resolveRole } = require("../config/models");
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
  ANSWER_SCORE_SCHEMA,
  answerScorePrompt,
  EVALUATION_SCHEMA,
  evaluationPrompt,
} = require("../utils/interviewPrompts");

const probeService = require("./probeService");
const backchannel = require("../utils/backchannel");

const PROVIDER = "openrouter";
const MAX_ANSWER_CHARS = 4000;

// Phase 8.3 — the closing condition is CODE, not the model: an interview may
// end early only when every claim-probe is covered AND the minimum length is
// reached. maxQuestions stays the hard ceiling (enforced in submitAnswer).
function closingAllowed(ai) {
  const uncovered = (ai.probes || []).filter((p) => p.status === "pending");
  return uncovered.length === 0 && ai.questionCount >= (ai.minQuestions || 1);
}

function pendingProbes(ai) {
  return (ai.probes || []).filter((p) => p.status === "pending");
}

// Mark the probe a just-pushed question turn addresses (validated: only a
// pending probe's id counts — the model can't invent coverage).
// How much of a question has to have been spoken for it to count as asked. A candidate who cut in
// on the last few words heard the question; one who cut in on the opening clause did not. The
// number is deliberately a constant in code rather than a model judgement — whether a probe was
// covered decides whether an interview may end, and that must be reproducible.
const DELIVERY_COVERAGE_MIN = 0.7;

function probeUncoveredByInterruption(questionTurn) {
  if (!questionTurn?.probeId) return false;
  const total = String(questionTurn.text || "").length;
  if (!total) return true;
  const spoken = Number(questionTurn.interruptedAtChar);
  if (!Number.isFinite(spoken)) return true; // interrupted, but we don't know where — assume not heard
  return spoken / total < DELIVERY_COVERAGE_MIN;
}

function markProbeAsked(ai, probeId) {
  if (!probeId) return;
  const probe = (ai.probes || []).find((p) => p.claimId === probeId && p.status === "pending");
  if (!probe) return;
  probe.status = "asked";
  probe.turnIndex = ai.turns.length - 1; // the question turn just pushed
  probe.askedAt = new Date();
}

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
  const lastAnswer = [...ai.turns].reverse().find((t) => t.role === "candidate");
  const answerScore = lastAnswer ? fallbackAnswerScore(lastAnswer.text) : 0;

  // Claim-probes are required coverage even on the deterministic path — their
  // questions were generated (and neutrality-checked) up front, so the fallback
  // can ask them verbatim.
  const probe = pendingProbes(ai).find((p) => !asked.has(p.question));
  if (probe) {
    return { answerScore, difficulty: ai.currentDifficulty, topic: "resume claims", question: probe.question, probeId: probe.claimId, isClosing: false };
  }

  const skillQs = (job.requiredSkills || []).map(
    (s) => `Can you explain how you've used ${s} in practice, and a limitation you ran into with it?`
  );
  const pool = [...skillQs, ...GENERIC_QUESTIONS];
  const question = pool.find((q) => !asked.has(q)) || GENERIC_QUESTIONS[ai.questionCount % GENERIC_QUESTIONS.length];

  return { answerScore, difficulty: ai.currentDifficulty, topic: "general", question, probeId: "", isClosing: false };
}

// The fallback must NEVER produce an adverse hiring decision — it routes to human review.
// Phase 9.2: unscored answers are EXCLUDED from the mean instead of being
// backfilled with a fabricated 55; with nothing scored the overall is null and
// the report honestly says "not measured".
function fallbackEvaluation(ai) {
  const scored = ai.turns
    .filter((t) => t.role === "candidate" && typeof t.answerScore === "number")
    .map((t) => t.answerScore);
  const overall = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null;
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
      (scored.length
        ? "These indicative scores come from answer-completeness heuristics and must NOT drive a hiring decision — a human should review the transcript."
        : "No answers were scored, so nothing here is measured — a human must review the transcript directly."),
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
    // Model comes from the registry (never a bare string in business logic) with
    // the tenant's CompanySettings override applied — Phase 2.5.
    const resolved = resolveRole("interview", settings);
    const { data, usage, model, cached } = await llm.generateJSON({
      system: INTERVIEWER_SYSTEM,
      prompt: planPrompt(context),
      schema: PLAN_SCHEMA,
      maxTokens: 640,
      model: resolved.model,
      temperature: settings?.ai?.temperature,
      promptVersion: PROMPT_VERSION,
    });
    await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "plan", provider: PROVIDER, model, usage, latencyMs: Date.now() - t0, engine: "ai", promptVersion: PROMPT_VERSION, cached });
    return { plan: data, engine: "ai" };
  } catch (err) {
    console.error(`[aiInterview] plan generation failed, using fallback (${err.code || "no code"}): ${err.message}`);
    return { plan: fallbackPlan(job), engine: "fallback" };
  }
}

async function nextQuestion({ session, candidate, job, settings, ai, context, useAi }) {
  if (!useAi) return { ...fallbackQuestion({ ai, job }), engine: "fallback", model: null, latencyMs: 0 };
  const t0 = Date.now();
  try {
    const resolved = resolveRole("interview", settings);
    const { data, usage, model, cached } = await llm.generateJSON({
      system: INTERVIEWER_SYSTEM,
      prompt: questionPrompt({
        context,
        plan: ai.plan || {},
        turns: ai.turns,
        currentDifficulty: ai.currentDifficulty,
        askedQuestions: ai.askedQuestions,
        questionCount: ai.questionCount,
        minQuestions: ai.minQuestions,
        maxQuestions: ai.maxQuestions,
        probes: pendingProbes(ai),
      }),
      schema: QUESTION_SCHEMA,
      maxTokens: 512,
      model: resolved.model,
      temperature: settings?.ai?.temperature,
      promptVersion: PROMPT_VERSION,
    });
    const latencyMs = Date.now() - t0;
    await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "question", provider: PROVIDER, model, usage, latencyMs, engine: "ai", promptVersion: PROMPT_VERSION, cached });
    return { ...data, engine: "ai", model, latencyMs };
  } catch (err) {
    console.error(`[aiInterview] question generation failed, using fallback (${err.code || "no code"}): ${err.message}`);
    return { ...fallbackQuestion({ ai, job }), engine: "fallback", model: null, latencyMs: Date.now() - t0 };
  }
}

// Phase 9.1 — score any candidate answer that never got an answerScore. The
// hard-stop closing path returns before the next-question call (the only path
// that used to assign scores), so the FINAL answer of every full-length
// interview was historically unscored. Runs at finalisation, bias-blinded.
async function scoreUnscoredAnswers({ session, candidate, job, settings, ai, useAi }) {
  const blindContext = buildContext(candidate, job, { blind: true });
  for (let i = 0; i < ai.turns.length; i += 1) {
    const turn = ai.turns[i];
    if (turn.role !== "candidate" || typeof turn.answerScore === "number") continue;
    const questionTurn = [...ai.turns.slice(0, i)].reverse().find((t) => t.role === "ai" && t.kind === "question");
    if (!questionTurn) continue;

    if (!useAi) {
      turn.answerScore = fallbackAnswerScore(turn.text);
      continue;
    }
    const t0 = Date.now();
    try {
      const resolved = resolveRole("interview", settings);
      const { data, usage, model, cached } = await llm.generateJSON({
        system: INTERVIEWER_SYSTEM,
        prompt: answerScorePrompt({ context: blindContext, question: questionTurn.text, answer: turn.text }),
        schema: ANSWER_SCORE_SCHEMA,
        maxTokens: 128,
        model: resolved.model,
        temperature: settings?.ai?.temperature,
        promptVersion: PROMPT_VERSION,
      });
      await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "evaluation", provider: PROVIDER, model, usage, latencyMs: Date.now() - t0, engine: "ai", promptVersion: PROMPT_VERSION, cached });
      const score = clampScore(data.answerScore);
      if (score !== undefined) turn.answerScore = score;
    } catch (err) {
      // Leave it unscored — an honest gap beats a fabricated number (9.2 shows
      // "not measured" rather than inventing one).
      console.error("[aiInterview] late answer scoring failed (left unscored):", err.message);
    }
  }
}

async function makeEvaluation({ session, candidate, job, settings, ai, useAi }) {
  if (!useAi) return fallbackEvaluation(ai);
  const t0 = Date.now();
  try {
    // Bias-blinded context: the candidate's name is withheld from the scoring prompt.
    const blindContext = buildContext(candidate, job, { blind: true });
    const resolved = resolveRole("interview", settings);
    const { data, usage, model, cached } = await llm.generateJSON({
      system: INTERVIEWER_SYSTEM,
      prompt: evaluationPrompt({ context: blindContext, turns: ai.turns }),
      schema: EVALUATION_SCHEMA,
      maxTokens: 1024,
      model: resolved.model,
      temperature: settings?.ai?.temperature,
      promptVersion: PROMPT_VERSION,
    });
    const latencyMs = Date.now() - t0;
    await usageService.recordUsage({ company: session.company, session: session._id, candidate: candidate._id, kind: "evaluation", provider: PROVIDER, model, usage, latencyMs, engine: "ai", promptVersion: PROMPT_VERSION, cached });
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
    console.error(`[aiInterview] evaluation failed, using fallback (${err.code || "no code"}): ${err.message}`);
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

  // Per-job length overrides (Phase 8.3), sanity-clamped so min ≤ max.
  if (job.interviewMaxQuestions) ai.maxQuestions = job.interviewMaxQuestions;
  if (job.interviewMinQuestions) ai.minQuestions = Math.min(job.interviewMinQuestions, ai.maxQuestions);

  // Claim-probes (Phase 8.1/8.2): this candidate's unverified high-weight
  // claims become required coverage. Failure ⇒ empty list, interview as today.
  const probeResult = await probeService.generateProbesForSession(session, candidate);
  ai.probes = probeResult.probes;
  ai.probeEngine = probeResult.engine;
  if (probeResult.probes.length > 0) {
    const { PROBE_PROMPT_VERSION } = require("../utils/probePrompts");
    ai.probePromptVersion = PROBE_PROMPT_VERSION;
  }

  ai.status = "in_progress";
  ai.startedAt = new Date();

  ai.turns.push({
    role: "ai",
    kind: "intro",
    text: `Hi ${candidate.basicDetails.name.split(" ")[0]}, thanks for joining. I'll ask you a few questions about your background and the ${job.title} role. Take your time, and let's get started.`,
  });

  const first = await nextQuestion({ session, candidate, job, settings, ai, context, useAi });
  ai.turns.push({ role: "ai", kind: "question", text: first.question, topic: first.topic, difficulty: first.difficulty, probeId: first.probeId || undefined, engine: first.engine, model: first.model, latencyMs: first.latencyMs });
  ai.askedQuestions.push(first.question);
  markProbeAsked(ai, first.probeId);
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
  const raw = String(answerText || "").trim().slice(0, MAX_ANSWER_CHARS);

  // The interviewer's own non-evaluative speech ("take your time — I'm here") is played while
  // the microphone is open, so it can land in the transcript. Strip it before anything treats
  // this text as the candidate's evidence — our words must never be scored as theirs. Only
  // phrases from the approved bank are removable, so the client cannot use this to delete its
  // own content (utils/backchannel.stripEcho).
  const echo = backchannel.stripEcho(raw, opts.backchannels);
  const text = echo.text;
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
    if (echo.removed.length) {
      answerTurn.backchannelEchoRemoved = echo.removed.length;
      console.warn(
        `[aiInterview] stripped ${echo.removed.length} backchannel echo(es) from a spoken answer ` +
          `(session ${session._id}) — client-side capture pausing is not holding on that device`
      );
    }
  }
  const lastQuestion = [...ai.turns].reverse().find((t) => t.role === "ai" && t.kind === "question");

  // How many times the candidate asked to hear the question again. Recorded on the QUESTION turn,
  // because that is what was repeated — and recorded ONLY there: it is a condition of the
  // interview, never an input to a score (see models/InterviewSession.js and utils/repeatIntent.js
  // for why treating it as a signal would be a disparate-impact machine).
  if (Number.isFinite(opts.repeatCount) && opts.repeatCount > 0 && lastQuestion) {
    lastQuestion.repeatCount = opts.repeatCount;
  }

  // Barge-in bookkeeping. `markProbeAsked` runs when a question is GENERATED, which assumed the
  // question would then be delivered in full — true for typed interviews and for the turn-based
  // voice path, but not once a candidate can talk over it. A probe the candidate never actually
  // heard has not been covered, so it goes back to pending and closingAllowed() will not let the
  // interview end on it. Without this, barge-in would quietly shorten interviews by letting
  // half-heard questions count as asked.
  if (lastQuestion && opts.questionDelivery && opts.questionDelivery.deliveredFully === false) {
    lastQuestion.deliveredFully = false;
    lastQuestion.interruptedAtChar = opts.questionDelivery.interruptedAtChar;
    if (probeUncoveredByInterruption(lastQuestion)) {
      const probe = (ai.probes || []).find((p) => p.claimId === lastQuestion.probeId && p.status === "asked");
      if (probe) {
        probe.status = "pending";
        probe.turnIndex = undefined;
        probe.askedAt = undefined;
      }
    }
  }

  ai.turns.push(answerTurn);

  // Record the interviewer's non-evaluative utterances against this answer. Deliberately NOT a
  // turn: it is part of the interview's conditions, not part of the instrument.
  if (Array.isArray(opts.backchannels) && opts.backchannels.length) {
    const turnIndex = ai.turns.length - 1;
    for (const b of opts.backchannels) {
      ai.backchannels.push({ kind: b.kind, phrase: b.phrase, turnIndex, at: b.at || new Date() });
    }
  }

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

  // Phase 8.3 — early end, decided by CODE: the model may propose closing
  // (isClosing), but it only takes effect once every probe is covered and the
  // minimum length is reached. In this path the model's "question" is a brief
  // closing statement, and the final answer was scored above (next.answerScore).
  if (next.isClosing && closingAllowed(ai)) {
    ai.turns.push({ role: "ai", kind: "closing", text: next.question, engine: next.engine, model: next.model, latencyMs: next.latencyMs });
    ai.status = "completed";
    ai.completedAt = new Date();
    session.status = "completed";
    session.completedAt = new Date();
    await session.save();
    scheduleFinalization(session._id);
    return publicState(session);
  }

  ai.turns.push({ role: "ai", kind: "question", text: next.question, topic: next.topic, difficulty: next.difficulty, probeId: next.probeId || undefined, engine: next.engine, model: next.model, latencyMs: next.latencyMs });
  ai.askedQuestions.push(next.question);
  markProbeAsked(ai, next.probeId);
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

  // Phase 9.1: the final answer (and any other scoring gap) is scored BEFORE
  // the overall evaluation, so every mean is over complete data.
  await scoreUnscoredAnswers({ session, candidate, job, settings, ai, useAi });

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

  // Phase 8: close the loop — assess claim-probe verdicts against the
  // transcript, write them back to the ClaimGraph, and rescore (a SECOND
  // assessment, stage post_interview). Failure never blocks completion, and a
  // contradicted verdict never triggers any pipeline transition here.
  await probeService.finalizeProbes(session, candidate);

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
      message: `${candidate.basicDetails.name}'s AI interview for ${job.title} is complete. Overall score: ${ai.evaluation.overallScore ?? "not measured"}${ai.evaluation.recommendation === "review" ? " (needs human review)" : ""}.`,
      meta: { candidateId: candidate._id, sessionId: session._id, score: ai.evaluation.overallScore, recommendation: ai.evaluation.recommendation },
    });
  } catch (err) {
    console.error("[aiInterview] admin notification failed:", err.message);
  }
}

module.exports = {
  beginInterview,
  submitAnswer,
  publicState,
  runFinalization,
  closingAllowed,
  // exported for tests (Phase 9 gates)
  scoreUnscoredAnswers,
  probeUncoveredByInterruption,
  fallbackEvaluation,
};
