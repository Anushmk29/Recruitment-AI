// Pure, deterministic logic for the recruiter-facing AI interview report. Nothing here
// touches the DB or mutates a candidate's pipeline stage — every function is a display
// computation over data the interview already produced (turns, evaluation, proctoring).
// The verdict/recommended-action are advisory only; a human still moves the candidate
// via the existing stage-transition endpoint (see services/pipelineService.js).

const MIN_RESPONSIVE_WORDS = 6;
// Fixed and independent of Job.atsThreshold, which gates resume screening — a different
// axis (resume completeness) from demonstrated interview competency.
const INTERVIEW_PASS_THRESHOLD = 60;

function wordCount(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

// Every filler example in the report spec ("hello", "don't know", "two days", "I want
// tell.") is under 6 words, so the word-count threshold alone catches them — no extra
// stoplist needed.
function isResponsive(text, minWords = MIN_RESPONSIVE_WORDS) {
  return wordCount(text) >= minWords;
}

// §2: per-answer word count / spoken duration / responsive tag, plus the aggregate
// recruiters scan first ("Responsive answers: X / N").
function computeAnswerSubstance(turns) {
  const answers = (turns || [])
    .filter((t) => t.role === "candidate")
    .map((t) => {
      const text = t.text || "";
      const durationSec = t.audioDurationMs != null ? Math.round(t.audioDurationMs / 1000) : null;
      return { text, wordCount: wordCount(text), durationSec, responsive: isResponsive(text) };
    });
  const responsiveCount = answers.filter((a) => a.responsive).length;
  return { answers, responsiveCount, totalAnswers: answers.length };
}

// §4: flags a session that's too short to be a real read on the candidate.
function computeDurationFlag({ startedAt, completedAt, questionCount }) {
  if (!startedAt || !completedAt || !questionCount) {
    return { abnormallyShort: false, secondsPerQuestion: null, totalSeconds: null };
  }
  const totalSeconds = Math.max(0, (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  const secondsPerQuestion = totalSeconds / questionCount;
  return { abnormallyShort: secondsPerQuestion < 60, secondsPerQuestion: Math.round(secondsPerQuestion), totalSeconds: Math.round(totalSeconds) };
}

// §9: heuristic competency classifier (nice-to-have — not a scored ground truth).
// Checked in this order so the more specific categories win over generic "backend" hits.
const COMPETENCY_KEYWORDS = [
  ["system_design", ["architecture", "system design", "trade-off", "tradeoff", "scalability", "scale to", "design data storage", "high traffic"]],
  ["database", ["database", "data storage", "read traffic", "sql", "mongo", "postgres", "mysql", "schema", "query", "nosql"]],
  ["debugging", ["debug", "debugging", "troubleshoot", "bug you", "never seen before"]],
  ["learning", ["learn a new", "learning", "quickly", "upskill"]],
  ["backend", ["api", "endpoint", "backend", "back-end", "server", "microservice", "node", "express"]],
  ["frontend", ["frontend", "front-end", "react", "vue", "angular", "css", "html", "component", "browser", "dom", "ui"]],
];

function mapCompetency(topic, questionText) {
  const haystack = `${topic || ""} ${questionText || ""}`.toLowerCase();
  for (const [label, keywords] of COMPETENCY_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return label;
  }
  return "general";
}

function truncate(str, max) {
  const s = String(str || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Pairs each interviewer question with the candidate's next answer, tags the
// competency it probes, and carries a short quoted snippet as evidence.
function buildCompetencyTable(turns) {
  const list = turns || [];
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.role !== "ai" || t.kind !== "question") continue;
    const answer = list.slice(i + 1).find((x) => x.role === "candidate" || x.role === "ai");
    const answerTurn = answer && answer.role === "candidate" ? answer : null;
    rows.push({
      question: t.text,
      competency: mapCompetency(t.topic, t.text),
      score: answerTurn && typeof answerTurn.answerScore === "number" ? answerTurn.answerScore : null,
      evidence: answerTurn ? truncate(answerTurn.text, 140) : null,
    });
  }
  return rows;
}

// §1 + §7: the single source of truth for the headline call. Every branch below is
// stated directly in the report spec — simple and explainable, no black box.
function computeVerdict({ responsiveCount, totalAnswers, engineRan, overallScore }) {
  if (!totalAnswers) {
    return { verdict: "CLEAR_REJECT", reason: "No answers were recorded.", confidence: "High" };
  }
  if (responsiveCount === 0) {
    return { verdict: "CLEAR_REJECT", reason: `0/${totalAnswers} answers responsive.`, confidence: "High" };
  }
  if (responsiveCount / totalAnswers < 0.5) {
    return { verdict: "CLEAR_REJECT", reason: `${responsiveCount}/${totalAnswers} answers responsive (below 50%).`, confidence: "High" };
  }
  if (!engineRan) {
    return {
      verdict: "REVIEW",
      reason: "Automated evaluation engine did not run; answers are substantive enough to need human review.",
      confidence: "Medium",
    };
  }
  if (overallScore == null) {
    return { verdict: "REVIEW", reason: "No competency score is available.", confidence: "Low" };
  }
  if (overallScore >= INTERVIEW_PASS_THRESHOLD) {
    return {
      verdict: "ADVANCE",
      reason: `Overall competency score ${overallScore}/100 meets the ${INTERVIEW_PASS_THRESHOLD} threshold.`,
      confidence: overallScore >= INTERVIEW_PASS_THRESHOLD + 15 ? "High" : "Medium",
    };
  }
  if (overallScore <= INTERVIEW_PASS_THRESHOLD - 20) {
    return {
      verdict: "CLEAR_REJECT",
      reason: `Overall competency score ${overallScore}/100 is well below the ${INTERVIEW_PASS_THRESHOLD} threshold.`,
      confidence: "High",
    };
  }
  return {
    verdict: "REVIEW",
    reason: `Overall competency score ${overallScore}/100 is below the ${INTERVIEW_PASS_THRESHOLD} threshold but within human-judgement range.`,
    confidence: "Medium",
  };
}

// §5: an explicit action verb + one-line justification. A REVIEW on a session that's
// itself abnormally short points to a broken/rushed session rather than a true read.
function recommendedAction(verdict, durationFlag) {
  if (verdict.verdict === "CLEAR_REJECT") return { action: "Reject", justification: verdict.reason };
  if (verdict.verdict === "ADVANCE") return { action: "Advance", justification: verdict.reason };
  if (durationFlag && durationFlag.abnormallyShort) {
    return {
      action: "Re-interview",
      justification: "Session ran abnormally short — likely a technical or environment issue rather than a true read on the candidate.",
    };
  }
  return { action: "Manual review", justification: verdict.reason };
}

// §3/§6: communication/technicalKnowledge/problemSolving should never be shown when
// they're identical (that's not three measurements, it's one number copied three times)
// or when any of them is missing. Covers both the deterministic fallback and an
// accidental AI tie.
function competencyTripletOrNull(ev) {
  if (!ev) return null;
  const { communication: c, technicalKnowledge: t, problemSolving: p } = ev;
  if (c == null || t == null || p == null) return null;
  if (c === t && t === p) return null;
  return { communication: c, technicalKnowledge: t, problemSolving: p };
}

module.exports = {
  MIN_RESPONSIVE_WORDS,
  INTERVIEW_PASS_THRESHOLD,
  wordCount,
  isResponsive,
  computeAnswerSubstance,
  computeDurationFlag,
  mapCompetency,
  buildCompetencyTable,
  computeVerdict,
  recommendedAction,
  competencyTripletOrNull,
};
