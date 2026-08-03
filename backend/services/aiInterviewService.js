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
const { runInBackground } = require("../utils/backgroundTasks");
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
const dialogueActs = require("../utils/dialogueActs");
const personaService = require("./personaService");
const questionSetService = require("./questionSetService");

const PROVIDER = "openrouter";
const MAX_ANSWER_CHARS = 4000;

// Phase 8.3 — the closing condition is CODE, not the model: an interview may
// end early only when every claim-probe is covered AND the minimum length is
// reached. maxQuestions stays the hard ceiling (enforced in submitAnswer).
function closingAllowed(ai) {
  const uncovered = (ai.probes || []).filter((p) => p.status === "pending");
  // An approved question the candidate was never asked means this interview did not run the
  // instrument the recruiter approved. The model may propose closing; it cannot close over an
  // uncovered approved question any more than it can over an uncovered claim-probe.
  const unasked = (ai.mustAsk || []).filter((q) => q.status === "pending");
  return uncovered.length === 0 && unasked.length === 0 && ai.questionCount >= (ai.minQuestions || 1);
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

// ---- Recruiter-approved must-ask questions (models/QuestionSet.js) ----------
//
// Required coverage in the same sense as claim-probes, with one difference that is the whole
// point of the feature: these are delivered VERBATIM by code. The model is never asked to
// produce them and never given the chance to reword one — a paraphrase is a different question,
// and "every candidate for this role was asked the same thing" stops being true the moment one
// candidate gets the recruiter's wording and the next gets the model's.

function pendingMustAsk(ai) {
  return (ai.mustAsk || []).filter((q) => q.status === "pending");
}

function markMustAskAsked(ai, questionId) {
  if (!questionId) return;
  const q = (ai.mustAsk || []).find((m) => m.questionId === questionId && m.status === "pending");
  if (!q) return;
  q.status = "asked";
  q.turnIndex = ai.turns.length - 1; // the question turn just pushed
  q.askedAt = new Date();
}

// Same rule as a probe: a question the candidate talked over was not really asked.
function mustAskUncoveredByInterruption(questionTurn) {
  if (!questionTurn?.mustAskId) return false;
  const total = String(questionTurn.text || "").length;
  if (!total) return true;
  const spoken = Number(questionTurn.interruptedAtChar);
  if (!Number.isFinite(spoken)) return true;
  return spoken / total < DELIVERY_COVERAGE_MIN;
}

// Which approved question to deliver next, or null to hand the turn to the adaptive engine.
//
// The cadence alternates — approved question, then one adaptive follow-up on whatever the
// candidate just said, then the next approved question. That is what keeps the set from being a
// form read end to end: the recruiter's questions anchor the comparison, the follow-ups do the
// actual probing. When the remaining budget no longer covers what still has to be asked, the
// alternation stops and coverage wins: an approved question is the part that must not be
// dropped.
function chooseMustAsk(ai) {
  const pending = pendingMustAsk(ai);
  if (!pending.length) return null;

  const remaining = (ai.maxQuestions || 0) - (ai.questionCount || 0);
  const reserved = pending.length + pendingProbes(ai).length;
  if (remaining <= reserved) return pending[0];

  const lastQuestion = [...(ai.turns || [])].reverse().find((t) => t.role === "ai" && t.kind === "question");
  if (lastQuestion?.mustAskId) return null; // the last turn was an approved one — follow up on it
  return pending[0];
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---- How much of the instrument actually produced evidence -----------------
//
// A declined question ("I don't know") is asked-but-unanswered. It is deliberately NOT scored
// zero — see the `declined` field on models/InterviewSession.js for why conflating a candid
// decline with a wrong answer is both unfair and self-defeating. But excluding it silently would
// be its own lie: a mean over the two questions someone answered would read exactly like a mean
// over eight, and would flatter the candidate who declined most.
//
// So it is excluded from the mean AND counted, and the count travels with the score everywhere
// the score goes. That is the whole resolution: neither number is fabricated, and a human can
// see what the number is actually over.
function coverageStats(ai) {
  const answers = (ai.turns || []).filter((t) => t.role === "candidate" && t.kind === "answer");
  const declined = answers.filter((t) => t.declined).length;
  return {
    asked: ai.questionCount || 0,
    answered: answers.length - declined,
    declined,
  };
}

// Beyond this share of declined questions, there is not enough demonstrated evidence for an
// automated recommendation to mean anything. Deliberately a constant in code rather than a model
// judgement or a tenant setting: "was there enough evidence to decide?" is the question an
// automated hiring decision is most likely to be challenged on, and the answer has to be the same
// for every candidate and stateable without reading a config.
const MAX_DECLINE_SHARE = 0.5;

// Whether CODE overrules the model's recommendation and routes to a human, and why.
//
// This is rule 6 (every automated adverse action needs a human) applied at the point it actually
// bites. A model handed a two-turn transcript will still confidently return "no_hire" — it has no
// way to know that the transcript is short because the candidate withdrew rather than because
// they failed. That distinction is not the model's to make, so it is not asked to.
function reviewRequiredReason(ai) {
  if (ai.status === "ended_early") {
    return "the candidate chose to end the interview before it finished, so most of the instrument was never run";
  }
  const c = coverageStats(ai);
  if (c.asked > 0 && c.declined / c.asked > MAX_DECLINE_SHARE) {
    return `the candidate declined ${c.declined} of ${c.asked} questions, leaving too little demonstrated evidence to support an automated recommendation`;
  }
  return null;
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

// ---- The opening (authored in code, never by the model) ----
//
// Candidates were previously dropped straight into question one. Nobody was greeted by name,
// nobody was told how long it would take, and nobody was told they could ask for a question to
// be repeated — an affordance the portal has always had and never mentioned. That is most of
// what makes a spoken interview feel like a form being read at you, and none of it needs a
// model: it is the same for every candidate for a role, so it is a constant, written here.

// A voice question plus its answer runs roughly two minutes. Rounded up to the nearest five so
// it reads as the estimate it is rather than as a promise we then break.
function estimatedMinutes(maxQuestions) {
  return Math.max(5, Math.ceil((maxQuestions * 2) / 5) * 5);
}

function openingScript({ candidate, job, persona, maxQuestions }) {
  const first = String(candidate?.basicDetails?.name || "").trim().split(/\s+/)[0] || "there";
  const interviewer = String(persona?.name || "").trim() || "your interviewer";
  const role = job?.title ? ` for the ${job.title} role` : "";
  return {
    intro:
      `Hi ${first} — my name is ${interviewer}, and I'll be running your interview${role} today. ` +
      `Here's how this will go. I'll start by asking you to introduce yourself, and then I'll ask you around ` +
      `${maxQuestions} questions covering your background and your experience. It usually takes about ` +
      `${estimatedMinutes(maxQuestions)} minutes in total. ` +
      `There's no rush on any of it — take the time you need to think before you answer, and if you'd like me ` +
      `to repeat a question at any point, just ask.`,
    warmup:
      `So, whenever you're ready — could you start with a short introduction? ` +
      `Just who you are, and what you've been working on recently.`,
  };
}

function closingScript(candidate) {
  const first = String(candidate?.basicDetails?.name || "").trim().split(/\s+/)[0];
  return (
    `That's everything I wanted to cover${first ? `, ${first}` : ""} — thank you for taking the time today. ` +
    `Your answers have been recorded, and the team will be in touch about the next steps. All the best.`
  );
}

// The closing when the candidate ended it themselves. Authored here, in code, for the same reason
// as every other spoken turn — and this one carries a promise, so its wording is not the model's
// to improvise.
//
// What it deliberately does NOT do: express regret, ask why, or offer to continue. Any of those
// would be pressure applied at the exact moment someone has said they want to stop, and the whole
// value of the exit is that it is honoured without negotiation. It also does not imply the
// application is over — ending an interview is the candidate's decision about this session, and
// what happens to their application is the hiring team's, not this machine's, to announce.
function withdrawalScript(candidate) {
  const first = String(candidate?.basicDetails?.name || "").trim().split(/\s+/)[0];
  return (
    `Understood${first ? `, ${first}` : ""} — we'll stop here. Thank you for the time you've given today. ` +
    `Everything you've said so far has been recorded and will go to the hiring team along with your ` +
    `application, and a person will review it. Nothing further is needed from you. All the best.`
  );
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
        mustAsk: pendingMustAsk(ai),
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
    // ONLY a real answer is scored, and the test is positive on purpose. It used to exclude the
    // opening self-introduction by name (`kind === "warmup_answer"`), which meant every candidate
    // turn kind added afterwards was scored by default until someone remembered to exclude it —
    // and the first one added, `meta_question`, is a candidate asking "how many more are there?".
    // Scoring that against the question it interrupted is exactly the failure the kind exists to
    // prevent. Inverting the test makes silence the safe answer: a new kind is not part of the
    // instrument until it is deliberately made part of it.
    if (turn.kind !== "answer") continue;
    // A decline is not a wrong answer and must never be scored as one. Without this the whole
    // point of the decline path evaporates at finalisation: every "I don't know" would arrive
    // here unscored, get sent to the scoring prompt like any other answer, and come back as the
    // near-zero it structurally has to be — putting the fabricated number back into the mean by
    // the back door. It stays unscored and is reported as declined instead (coverageStats).
    if (turn.declined) continue;
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
    // The spoken greeting, surfaced separately from `turns` because the client speaks it ONCE,
    // ahead of the first question. It used to be pushed as a turn and rendered on screen but
    // never spoken by anything — so in a voice interview the candidate was never actually
    // greeted. Kept out of `currentQuestion` because it is not a question and must not be
    // re-spoken on every poll.
    intro: ai.turns.find((t) => t.kind === "intro")?.text || null,
    currentQuestion: ai.status === "in_progress" ? lastAi?.text || null : null,
    // The current turn is the opening self-introduction rather than a scored question, so the UI
    // can label it honestly instead of counting it as "Question 0 of 8".
    currentIsWarmup: ai.status === "in_progress" && lastAi?.kind === "warmup",
    awaitingAnswer: ai.status === "in_progress",
    // "Over" for the UI's purposes covers both endings — the room must show the end screen either
    // way, and must never leave a candidate who withdrew staring at an open microphone.
    completed: ai.status === "completed" || ai.status === "ended_early",
    // ...but the two are surfaced distinctly, because what the candidate is told differs. Someone
    // who finished hears that their answers are with the team; someone who stopped should not be
    // shown a screen implying they completed something they deliberately did not.
    endedEarly: ai.status === "ended_early",
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

  // The recruiter-approved must-ask set for this job profile (services/questionSetService).
  // Copied onto the session rather than referenced: this session must be able to state exactly
  // what it asked even after the set is superseded, and coverage is per-session state.
  // No approved set is a fully working interview — claim-probes plus adaptive questions, as
  // before — so adopting one is opt-in per job and never a prerequisite for hiring.
  const questionSet = await questionSetService.resolveForJob(session.company, job._id);
  ai.mustAsk = questionSet.questions.map((q) => ({
    questionId: q.id,
    text: q.text,
    topic: q.topic || "",
    status: "pending",
  }));
  ai.questionSet = {
    id: questionSet.id || undefined,
    version: questionSet.version,
    source: questionSet.source,
    at: new Date(),
  };

  // The approved set is the instrument; the length cap must yield to it rather than silently
  // dropping part of it. Without this, a set larger than maxQuestions would leave approved
  // questions unasked — and closingAllowed would then refuse to end the interview at all.
  const requiredCoverage = ai.mustAsk.length + (ai.probes || []).length;
  if (requiredCoverage > ai.maxQuestions) {
    console.warn(
      `[aiInterview] raising maxQuestions ${ai.maxQuestions} → ${requiredCoverage} for session ${session._id}: ` +
        `${ai.mustAsk.length} approved question(s) + ${(ai.probes || []).length} claim-probe(s) do not fit the configured cap`
    );
    ai.maxQuestions = requiredCoverage;
  }
  if (ai.minQuestions > ai.maxQuestions) ai.minQuestions = ai.maxQuestions;

  ai.status = "in_progress";
  ai.startedAt = new Date();

  // Greeted by name, in the persona's name, before anything is asked of them.
  const persona = await personaService.resolveForSession(session);
  const script = openingScript({ candidate, job, persona, maxQuestions: ai.maxQuestions });
  ai.turns.push({ role: "ai", kind: "intro", text: script.intro });

  // The opening turn is a self-introduction, not a question of the instrument. It eases the
  // candidate in and gives the first real question something to follow up on, but it is NOT
  // scored, NOT tied to a claim-probe, and does NOT consume the question budget — questionCount
  // stays at 0 until the first rubric-bound question is asked, on the next submit. Asking the
  // model to open cold also produced worse first questions: it had nothing from the candidate
  // to build on, so it fell back to reciting the résumé.
  ai.turns.push({ role: "ai", kind: "warmup", text: script.warmup });
  ai.askedQuestions.push(script.warmup);
  ai.questionCount = 0;

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

  // An answer to the opening self-introduction is marked as such and stays out of every scoring
  // path (see the score guard below and scoreUnscoredAnswers). "Tell me about yourself" has no
  // rubric criterion behind it, so a number attached to it would be a judgement with nothing to
  // justify it — and it would drag the mean that a real hiring decision reads.
  const precedingAi = [...ai.turns].reverse().find((t) => t.role === "ai");
  const isWarmupAnswer = precedingAi?.kind === "warmup";
  const answerTurn = {
    role: "candidate",
    kind: isWarmupAnswer ? "warmup_answer" : "answer",
    text,
    inputMode: opts.inputMode === "voice" ? "voice" : "text",
  };
  if (opts.inputMode === "voice") {
    ai.modality = "voice";
    if (opts.transcriptConfidence !== undefined) answerTurn.transcriptConfidence = opts.transcriptConfidence;
    if (opts.audioDurationMs !== undefined) answerTurn.audioDurationMs = opts.audioDurationMs;
    if (opts.acoustic) {
      // Derive the per-answer delivery score server-side (never trust a client-sent score).
      answerTurn.acoustic = { ...opts.acoustic, deliveryScore: scoreDelivery(opts.acoustic) };
    }
    // Why the turn ended. Recorded next to the answer it belongs to so a disputed "it cut me
    // off" is checkable; read by no scorer.
    if (opts.endOfTurn) answerTurn.endOfTurn = opts.endOfTurn;
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
    // Same for an approved question the candidate talked over: it was not really asked, so it
    // goes back into the queue and closingAllowed will not let the interview end without it.
    if (mustAskUncoveredByInterruption(lastQuestion)) {
      const q = (ai.mustAsk || []).find((m) => m.questionId === lastQuestion.mustAskId && m.status === "asked");
      if (q) {
        q.status = "pending";
        q.turnIndex = undefined;
        q.askedAt = undefined;
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

  return advance(session);
}

// Decide and deliver the interviewer's next turn: complete, an approved must-ask question, or an
// adaptive one. Extracted from submitAnswer so the dialogue-act paths reach the next question
// through exactly the same code — a decline has to advance the interview identically to an
// answer, and a second copy of this logic would be a second place for the two to drift apart.
async function advance(session) {
  const ai = session.aiInterview;
  const { candidate, job } = await loadRefs(session);
  const settings = await loadSettings(session.company);
  const context = buildContext(candidate, job);
  const useAi = await aiUsable(session, candidate, settings);

  if (ai.questionCount >= ai.maxQuestions) {
    ai.turns.push({ role: "ai", kind: "closing", text: closingScript(candidate) });
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

  // An approved must-ask question is delivered VERBATIM, by code, with no model call at all.
  // That is both the guarantee (the recruiter's wording reaches every candidate unaltered) and,
  // incidentally, free: these turns cost nothing and add no latency.
  //
  // The previous answer goes unscored on this path because scoring lived inside nextQuestion().
  // That is safe and already designed for — finalisation scores every unscored answer through
  // the dedicated bias-blinded prompt (scoreUnscoredAnswers, Phase 9.1) — and it is better than
  // the alternative of making a model call purely to attach a number mid-interview.
  const must = chooseMustAsk(ai);
  if (must) {
    ai.turns.push({
      role: "ai",
      kind: "question",
      text: must.text,
      topic: must.topic || "approved set",
      mustAskId: must.questionId,
      engine: "approved_set",
    });
    ai.askedQuestions.push(must.text);
    markMustAskAsked(ai, must.questionId);
    ai.questionCount += 1;
    await session.save();
    return publicState(session);
  }

  const next = await nextQuestion({ session, candidate, job, settings, ai, context, useAi });
  const lastAnswer = [...ai.turns].reverse().find((t) => t.role === "candidate");
  const score = clampScore(next.answerScore);
  // The model scores "the previous answer" unconditionally, and on the first pass that answer is
  // the self-introduction. Discard it rather than record it: nothing in the rubric backs it. Same
  // for a decline — the model will happily score "I don't know" a 5, and that 5 would be a
  // judgement about an answer nobody gave.
  if (lastAnswer && lastAnswer.kind !== "warmup_answer" && !lastAnswer.declined && score !== undefined) {
    lastAnswer.answerScore = score;
  }
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

// ---- Dialogue acts: the candidate talking ABOUT the interview --------------
//
// See utils/dialogueActs.js for what the acts are and why detection is deterministic. This is the
// server half: the browser reports which act it detected (it has to — detection must be instant),
// and this RE-RUNS the same rules against the same transcript before acting on any of it.
//
// That re-check is not paranoia about a malicious candidate; there is nothing here worth
// attacking (the worst available outcome is ending your own interview, which the button already
// offers). It is that "the client said so" is not an acceptable answer to "why did this interview
// end?", and one day someone will ask. The stored record has to name a trigger phrase and a rule.

async function submitDialogueAct(session, act, opts = {}) {
  const ai = session.aiInterview;
  if (ai.status !== "in_progress") {
    throw Object.assign(new Error("The interview is not in progress"), { status: 400 });
  }

  if (act === "pause") return handlePause(session, opts);
  if (act === "decline") return handleDecline(session, opts);
  if (act === "withdraw") return handleWithdraw(session, opts);
  throw Object.assign(new Error("Unknown conversational act"), { status: 400 });
}

// "Give me a second." Nothing to decide and nothing to record on the instrument — the interviewer
// simply says it is waiting, and the browser extends its own silence window. It is logged as a
// backchannel so the interview's real conditions stay reconstructible, and that is all it is.
async function handlePause(session, opts) {
  const ai = session.aiInterview;
  ai.backchannels.push({
    kind: "pause",
    phrase: backchannel.phraseFor("pause", ai.backchannels.length),
    turnIndex: ai.turns.length - 1,
    at: opts.at ? new Date(opts.at) : new Date(),
  });
  await session.save();
  return publicState(session);
}

// "I don't know." / "Can we skip this one?"
//
// Recorded verbatim as the candidate's turn — their words are their words, and tidying them out
// of the transcript is not this system's call — but flagged `declined`, which is what keeps it out
// of every scoring path. Then the interview advances exactly as it would after any other answer.
//
// Note what does NOT happen: the probe or approved question this was asked against stays `asked`.
// It WAS asked; the candidate heard it and responded. What it did not produce is evidence, and
// that shows up as an `inconclusive` verdict, not as an uncovered probe. Putting it back to
// pending would mean re-asking a question the candidate has already declined, which is the one
// thing a person would obviously not do.
async function handleDecline(session, opts) {
  const ai = session.aiInterview;
  const raw = String(opts.text || "").trim().slice(0, MAX_ANSWER_CHARS);
  const echo = backchannel.stripEcho(raw, opts.backchannels);
  const text = echo.text;
  if (!text) throw Object.assign(new Error("A transcript is required"), { status: 400 });

  // Re-run the detection server-side. A client that reports "decline" over a real answer would
  // otherwise be able to discard that answer from scoring, which is the one direction of this
  // that a candidate could actually benefit from.
  const verdict = dialogueActs.detect(text);
  if (verdict.act !== "decline" || !verdict.honour) {
    // Not a decline on the server's reading — treat it as the answer it appears to be, through
    // the ordinary path. Falling back to submitAnswer rather than erroring means a disagreement
    // between the two readings can never cost the candidate their words.
    console.warn(
      `[aiInterview] client reported a decline the server does not read as one (session ${session._id}, ` +
        `act=${verdict.act || "none"}, otherWords=${verdict.otherWords}) — recording it as an answer`
    );
    return submitAnswer(session, text, opts);
  }

  const precedingAi = [...ai.turns].reverse().find((t) => t.role === "ai");
  if (precedingAi?.kind === "warmup") {
    // Declining the self-introduction is not a decline of anything scored — there is no rubric
    // criterion behind "tell me about yourself". Record it as the warmup answer it is.
    return submitAnswer(session, text, opts);
  }

  ai.turns.push({
    role: "candidate",
    kind: "answer",
    text,
    declined: true,
    declineAct: "decline",
    inputMode: opts.inputMode === "voice" ? "voice" : "text",
    ...(opts.transcriptConfidence !== undefined ? { transcriptConfidence: opts.transcriptConfidence } : {}),
    ...(opts.audioDurationMs !== undefined ? { audioDurationMs: opts.audioDurationMs } : {}),
  });
  if (opts.inputMode === "voice") ai.modality = "voice";

  const turnIndex = ai.turns.length - 1;
  ai.backchannels.push({
    kind: "decline",
    phrase: backchannel.phraseFor("decline", ai.questionCount || 0),
    turnIndex,
    at: new Date(),
  });
  for (const b of Array.isArray(opts.backchannels) ? opts.backchannels : []) {
    ai.backchannels.push({ kind: b.kind, phrase: b.phrase, turnIndex, at: b.at || new Date() });
  }

  return advance(session);
}

// "I don't want to do this."
//
// The only irreversible action a candidate can take here, and therefore the only one that is
// never taken on a single utterance. The browser must already have asked the confirmation
// question and got an affirmative (or the candidate pressed the explicit End button, which needs
// no confirmation — a button press is unambiguous by construction). Both are re-verified here.
//
// Rule 6 in the sharpest form it takes anywhere in this system: what follows must never be an
// automated adverse action. The partial transcript is preserved, evaluated only for what it
// actually contains, and the recommendation is forced to "review" by code
// (see reviewRequiredReason) so no candidate is ever auto-rejected for exercising an exit.
async function handleWithdraw(session, opts) {
  const ai = session.aiInterview;
  const confirmedBy = opts.confirmedBy === "explicit" ? "explicit" : "spoken";

  if (confirmedBy === "spoken") {
    const requestText = String(opts.text || "").trim().slice(0, MAX_ANSWER_CHARS);
    const confirmText = String(opts.confirmText || "").trim().slice(0, MAX_ANSWER_CHARS);
    const request = dialogueActs.detect(requestText);
    if (request.act !== "withdraw" || !request.honour) {
      throw Object.assign(
        new Error("That did not read as a request to end the interview — the interview is continuing"),
        { status: 400, code: "WITHDRAW_NOT_RECOGNISED" }
      );
    }
    // Anything that is not a recognised yes resumes the interview. Silence, a half-sentence and
    // an outright no are all the same answer here, and it is the recoverable one.
    if (dialogueActs.detectConfirmation(confirmText) !== "yes") {
      throw Object.assign(
        new Error("The interview was not ended — no confirmation was given"),
        { status: 400, code: "WITHDRAW_NOT_CONFIRMED" }
      );
    }
    ai.endedEarly = {
      by: "candidate",
      requestText,
      matchedTrigger: request.matchedTrigger,
      confirmedBy,
      confirmText,
    };
  } else {
    ai.endedEarly = { by: "candidate", confirmedBy: "explicit" };
  }

  const { candidate } = await loadRefs(session);
  const stats = coverageStats(ai);
  ai.endedEarly.questionsAsked = stats.asked;
  ai.endedEarly.questionsAnswered = stats.answered;
  ai.endedEarly.at = new Date();

  ai.turns.push({ role: "ai", kind: "closing", text: withdrawalScript(candidate) });
  ai.status = "ended_early";
  ai.completedAt = new Date();
  // The SESSION is "completed" in the operational sense — it is over, it must not be resumable,
  // and the expiry job must not later mark it expired. What actually happened is carried by
  // aiInterview.status, which is where every consumer that cares about the difference reads it.
  session.status = "completed";
  session.completedAt = new Date();
  await session.save();

  console.warn(
    `[aiInterview] session ${session._id} ended early by the candidate after ${stats.asked} question(s) ` +
      `(${stats.answered} answered, ${stats.declined} declined, confirmedBy=${confirmedBy})`
  );

  scheduleFinalization(session._id);
  return publicState(session);
}

// Detached: decouple the (slow, high-token) evaluation from the candidate's HTTP request.
function scheduleFinalization(sessionId) {
  runInBackground(`finalize interview ${sessionId}`, () =>
    tenantContext
      .runAsSystem(() => runFinalization(sessionId))
      .catch((err) => console.error("[aiInterview] finalization failed:", err.message))
  );
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

  // How much of the instrument produced evidence, attached to the score so the two can never be
  // read apart. Computed here in code — the model is never asked how complete its own input was.
  const stats = coverageStats(ai);
  evaluation.questionsAsked = stats.asked;
  evaluation.questionsAnswered = stats.answered;
  evaluation.questionsDeclined = stats.declined;

  // CODE overrules the model's recommendation when the transcript cannot support one. The model
  // returned a recommendation because the schema requires one; whether there was enough interview
  // behind it to act on is not a question it is in a position to answer, so it is not asked.
  const reason = reviewRequiredReason(ai);
  if (reason) {
    evaluation.reviewReason = reason;
    evaluation.recommendation = "review";
    evaluation.summary =
      `No automated recommendation: ${reason}. A human must review this interview before any decision is taken. ` +
      (stats.answered > 0
        ? `What follows describes only the ${stats.answered} question(s) the candidate actually answered. `
        : `The candidate answered no scored questions, so nothing below is measured. `) +
      String(evaluation.summary || "");
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
  submitDialogueAct,
  publicState,
  runFinalization,
  closingAllowed,
  // exported for tests (dialogue acts + the evidence-coverage guards)
  coverageStats,
  reviewRequiredReason,
  withdrawalScript,
  MAX_DECLINE_SHARE,
  // exported for tests (Phase 9 gates)
  scoreUnscoredAnswers,
  probeUncoveredByInterruption,
  fallbackEvaluation,
  // exported for tests (the authored opening/closing)
  openingScript,
  closingScript,
  estimatedMinutes,
  // exported for tests (recruiter-approved must-ask coverage)
  chooseMustAsk,
  mustAskUncoveredByInterruption,
  pendingMustAsk,
};
