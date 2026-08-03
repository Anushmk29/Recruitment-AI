// Pure prompt + JSON-schema builders for the AI Interview Engine (Module 9).
// No SDK/DB here — llmService consumes these. The system prompt frames Claude
// as an experienced human technical interviewer, not a chatbot.

// Bump when the prompt wording changes so stored AI decisions record which prompt
// produced them (reproducibility / auditability — W4).
// 2026-07-25.2: Phase 8 — claim-probes as required coverage, probeId in the
// question schema, and honest closing semantics (isClosing is now read by code).
// 2026-08-03.1: recruiter-approved must-ask questions. They are delivered verbatim
// by code, so the model is told what is coming purely so it does not pre-empt or
// paraphrase one, and closing is additionally gated on all of them having been asked.
const PROMPT_VERSION = "2026-08-03.1";

// The fence + security preamble are shared with the résumé pipeline via
// promptSafety (Phase 4.3). SECURITY_SENTENCE is byte-identical to the string
// previously inlined here, so this prompt's bytes — and therefore its replay
// fixtures and PROMPT_VERSION — are unchanged.
const { SECURITY_SENTENCE, fenceUntrusted } = require("./promptSafety");

const INTERVIEWER_SYSTEM =
  "You are an experienced senior technical interviewer conducting a live, voice-style interview. " +
  "Behave like a real human interviewer, not a chatbot: ask one focused question at a time, listen to the full answer, " +
  "probe with natural follow-ups, adapt difficulty to the candidate's demonstrated level, and never repeat a question. " +
  "Keep each spoken turn concise (1-3 sentences). Base every question on the job description, the resume, and what the " +
  "candidate has said so far. Judge answers on correctness, depth, and practical understanding — not keyword matching. " +
  SECURITY_SENTENCE;

function truncate(str, max) {
  const s = String(str || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Compact, token-bounded briefing assembled from the candidate + job records.
// Untrusted candidate-supplied text is fenced in <candidate_data> tags (prompt-injection
// defense — W4). `blind` omits the candidate's name so the evaluation prompt can't be
// influenced by a name-based proxy for a protected class (bias mitigation).
function buildContext(candidate, job, { blind = false } = {}) {
  const b = candidate.basicDetails || {};
  const skills = (candidate.skills || []).join(", ");
  const experience = (candidate.experience || [])
    .map((e) => `${e.role || ""} @ ${e.company || ""} (${e.startDate || "?"}–${e.currentlyWorking ? "present" : e.endDate || "?"})`)
    .join("; ");
  const education = (candidate.education || [])
    .map((e) => `${e.degree || ""}${e.fieldOfStudy ? " in " + e.fieldOfStudy : ""} — ${e.institution || ""}`)
    .join("; ");
  const projects = (candidate.projects || [])
    .map((p) => `${p.title || ""}${p.techStack ? " [" + p.techStack + "]" : ""}: ${truncate(p.description, 160)}`)
    .join("\n");
  const ats = candidate.ats || {};

  const jobBlock = [
    `JOB TITLE: ${job.title}`,
    job.department ? `DEPARTMENT: ${job.department}` : "",
    `JOB DESCRIPTION:\n${truncate(job.description, 1200)}`,
    job.requirements ? `REQUIREMENTS:\n${truncate(job.requirements, 800)}` : "",
    job.requiredSkills?.length ? `REQUIRED SKILLS: ${job.requiredSkills.join(", ")}` : "",
    `MIN EXPERIENCE: ${job.minExperienceYears || 0} years`,
  ]
    .filter(Boolean)
    .join("\n");

  const candidateBlock = [
    blind ? "" : `CANDIDATE NAME: ${b.name}`,
    skills ? `CANDIDATE SKILLS: ${skills}` : "",
    experience ? `EXPERIENCE: ${experience}` : "",
    education ? `EDUCATION: ${education}` : "",
    projects ? `PROJECTS:\n${projects}` : "",
    ats.overallScore != null ? `ATS SCORE: ${ats.overallScore} (missing: ${(ats.missingSkills || []).join(", ") || "none"})` : "",
    candidate.resumeText ? `RESUME TEXT (excerpt):\n${truncate(candidate.resumeText, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [jobBlock, "---", fenceUntrusted(candidateBlock)].join("\n");
}

// ---- Interview plan ----
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    role: { type: "string" },
    difficultyEstimate: { type: "string", enum: ["easy", "medium", "hard"] },
    topics: { type: "array", items: { type: "string" } },
    focusAreas: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["role", "difficultyEstimate", "topics", "focusAreas", "summary"],
};

function planPrompt(context) {
  return (
    `Read the job and candidate below and produce an interview plan.\n\n${context}\n\n` +
    `Estimate an appropriate starting difficulty for this role and seniority, list the question topics to cover ` +
    `(drawn from the job description and the candidate's actual skills/projects), and the areas to probe most. ` +
    `Return the plan as JSON.`
  );
}

// ---- Next question ----
const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answerScore: { type: "integer" }, // 0-100 for the PREVIOUS answer; use 0 when there is none yet
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    topic: { type: "string" },
    question: { type: "string" },
    // Which required-coverage probe this question addresses ("" when none) — Phase 8.2.
    probeId: { type: "string" },
    isClosing: { type: "boolean" },
  },
  required: ["answerScore", "difficulty", "topic", "question", "probeId", "isClosing"],
};

function transcriptText(turns) {
  return turns
    .map((t) => `${t.role === "ai" ? "INTERVIEWER" : "CANDIDATE"}: ${t.text}`)
    .join("\n");
}

// Required-coverage block (Phase 8.2): uncovered claim-probes the interview
// MUST ask before it can end. Phrasing arrives pre-checked for neutrality.
function probeBlock(probes) {
  if (!Array.isArray(probes) || probes.length === 0) return "";
  const lines = probes.map((p) => `- probeId "${p.claimId}": ${p.question}`);
  return (
    `REQUIRED COVERAGE — each of these topics must be asked before the interview can end. When you ask one ` +
    `(use the suggested wording or a natural, equally neutral variant), set "probeId" to its id; otherwise set probeId="":\n` +
    `${lines.join("\n")}\n\n`
  );
}

// Recruiter-approved questions still to come. The model is told about them so it does NOT
// pre-empt or paraphrase one — they are delivered verbatim by code (aiInterviewService), and a
// model that asked its own version first would leave the approved one arriving as a duplicate.
function mustAskBlock(mustAsk) {
  if (!Array.isArray(mustAsk) || mustAsk.length === 0) return "";
  const lines = mustAsk.map((q) => `- ${q.text}`);
  return (
    `RECRUITER-APPROVED QUESTIONS STILL TO COME — these will be asked automatically, word for ` +
    `word, and are NOT yours to ask. Do not ask them, do not rephrase them, and do not ask ` +
    `anything that would make them redundant. Your job is to follow up on what the candidate ` +
    `actually said:\n${lines.join("\n")}\n\n`
  );
}

function questionPrompt({ context, plan, turns, currentDifficulty, askedQuestions, questionCount, minQuestions, maxQuestions, probes, mustAsk }) {
  const remaining = maxQuestions - questionCount;
  const uncovered = (probes || []).length;
  const unasked = (mustAsk || []).length;
  const mustCoverNow = uncovered > 0 && remaining <= uncovered + unasked;
  // An approved question that has not been asked yet means the interview has not run the
  // instrument the recruiter approved, so it cannot close — same gate as an uncovered probe.
  const canClose = uncovered === 0 && unasked === 0 && questionCount >= (minQuestions || 1);
  return (
    `${context}\n\n` +
    `INTERVIEW PLAN: topics=${(plan.topics || []).join(", ")}; focus=${(plan.focusAreas || []).join(", ")}.\n\n` +
    mustAskBlock(mustAsk) +
    probeBlock(probes) +
    `CONVERSATION SO FAR:\n${transcriptText(turns) || "(none yet — this is the opening)"}\n\n` +
    `ALREADY ASKED (never repeat these):\n${(askedQuestions || []).map((q) => "- " + q).join("\n") || "(none)"}\n\n` +
    `Current difficulty: ${currentDifficulty}. Questions asked: ${questionCount}/${maxQuestions}.\n\n` +
    `Instructions: First, score the candidate's most recent answer 0-100 in "answerScore" (use 0 if there is no answer yet). ` +
    `Then decide the next difficulty: if the last answer was strong, increase difficulty; if they struggled, decrease it; ` +
    `if they said they don't know, move to a different topic. Ask ONE new question grounded in their resume/projects and the ` +
    `job — prefer a natural follow-up to what they just said. Never repeat an already-asked question. ` +
    (mustCoverNow ? `Only ${remaining} question(s) remain and ${uncovered} required topic(s) are uncovered — cover a required topic NOW. ` : ``) +
    (canClose
      ? `All required topics are covered. If the interview has naturally reached its end, you may close: set isClosing=true and make "question" a brief, warm closing statement (no new question). Otherwise set isClosing=false and continue. `
      : `Set isClosing=false. `) +
    `Return JSON.`
  );
}

// ---- Late answer scoring (Phase 9.1) ----
// The hard-stop path completes the interview without a next-question call, so
// the final answer historically was NEVER scored. Finalisation scores any
// unscored answer through this dedicated, bias-blinded prompt.
const ANSWER_SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answerScore: { type: "integer" }, // 0-100
  },
  required: ["answerScore"],
};

// ---- Spoken communication (utils/communication.js) ----
//
// The model OBSERVES; code scores. Every field is a yes/no with the quote that evidences it, and
// an observation that cannot be quoted is dropped rather than trusted.
//
// Note what this prompt refuses to ask for. Not "rate their communication out of ten" — that
// returns the model's overall impression of the candidate wearing a number. Not anything about
// how they SOUNDED: pace, hesitation and filler words never reach the model, because they are not
// in the transcript, which is exactly why this can be assessed at all.
const COMMUNICATION_SYSTEM =
  "You observe how clearly a candidate explained something, from a transcript of what they said. " +
  "You never judge whether the answer was technically correct — that is assessed separately and " +
  "is not your concern. You never comment on the person. You report only what you can quote.";

function communicationPrompt({ question, answer }) {
  return (
    `QUESTION THEY WERE ASKED:\n${question}\n\n` +
    `WHAT THEY SAID (a transcript of speech — expect no punctuation to be reliable, and expect ` +
    `false starts and repetition, which are normal in speech and are NOT communication problems):\n` +
    `${fenceUntrusted(answer)}\n\n` +
    `For each field, answer true or false and give a SHORT VERBATIM QUOTE from the transcript that ` +
    `shows it. If a field is false, leave the quote empty. If you cannot find a real quote, answer ` +
    `false rather than inventing one.\n\n` +
    `- answersTheQuestion — did they address what was actually asked, rather than something near it?\n` +
    `- hasConcreteExample — did they give a specific instance (a system, a number, a decision, a ` +
    `moment) rather than describing how one generally does this kind of work?\n` +
    `- termsAreExplained — is the jargon they introduced explained, or did none need explaining? ` +
    `Precise technical language used precisely is GOOD communication — do not mark it down for ` +
    `being technical.\n` +
    `- referencesAreResolvable — could a listener who was not there follow it? False only when ` +
    `"it", "they" or "that" is left with no antecedent a reader could recover.\n` +
    `- statedUncertaintyWhereItExisted — did they mark the boundary of what they knew ("I'm not ` +
    `certain of the exact figure, but…")? This is a STRENGTH. If there was nothing they were ` +
    `unsure about, answer false — it is simply not evidence either way.\n` +
    `- overclaimed — did they assert specifics the rest of the answer gives no basis for, or ` +
    `contradict something they said earlier? Ordinary hedging is NOT overclaiming.\n` +
    `- ownContributionIsClear — is it clear what THEY did, as opposed to what their team did?\n\n` +
    `Return JSON.`
  );
}

function answerScorePrompt({ context, question, answer }) {
  return (
    `${context}\n\n` +
    `QUESTION ASKED:\n${question}\n\n` +
    `CANDIDATE ANSWER:\n${answer}\n\n` +
    `Score this single answer 0-100 for correctness, depth, and practical understanding, exactly as you would have ` +
    `scored it during the interview. Judge only what the answer demonstrates. Return JSON.`
  );
}

// ---- Final evaluation ----
const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallScore: { type: "integer" },
    communication: { type: "integer" },
    technicalKnowledge: { type: "integer" },
    problemSolving: { type: "integer" },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    missingSkills: { type: "array", items: { type: "string" } },
    recommendation: { type: "string", enum: ["strong_hire", "hire", "maybe", "no_hire"] },
    summary: { type: "string" },
  },
  required: [
    "overallScore",
    "communication",
    "technicalKnowledge",
    "problemSolving",
    "strengths",
    "weaknesses",
    "missingSkills",
    "recommendation",
    "summary",
  ],
};

function evaluationPrompt({ context, turns }) {
  return (
    `${context}\n\n` +
    `FULL INTERVIEW TRANSCRIPT:\n${transcriptText(turns)}\n\n` +
    `Evaluate this candidate for the role. Score communication, technical knowledge, and problem solving 0-100, ` +
    `give an overall score 0-100, list concrete strengths and weaknesses, list any required skills that appeared weak or missing, ` +
    `and give a hiring recommendation. Base every judgement STRICTLY on the competencies the candidate demonstrated in the ` +
    `transcript. Do NOT consider or infer name, gender, age, ethnicity, nationality, or any other protected characteristic — ` +
    `assess job-relevant ability only. Return JSON.`
  );
}

module.exports = {
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
  COMMUNICATION_SYSTEM,
  communicationPrompt,
};
