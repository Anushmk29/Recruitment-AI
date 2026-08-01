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

// ---------------------------------------------------------------------------
// Evidence coverage matrix
// ---------------------------------------------------------------------------
// One row per rubric criterion; one cell per evidence source (résumé / assessment
// / interview). This is the Claim → Probe → Verdict loop rendered as a grid: what
// the ROLE required, what the résumé CLAIMED, whether we TESTED it, and what the
// test SHOWED. Pure joining over already-scored data — no model runs here and no
// number is invented (§3 rule 1). "Not tested" is a first-class state and is
// never dressed up as a measurement (§3 rule 5).

const CELL = { verified: "verified", partial: "partial", contradicted: "contradicted", absent: "absent", untested: "untested" };

// The résumé leg is already scored per criterion by evidenceScorer.computeAssessment.
const RESUME_CELL = { satisfied: CELL.verified, partial: CELL.partial, contradicted: CELL.contradicted, absent: CELL.absent };

// The assessment leg is a ratio of targeted items. Thresholds are deliberately
// coarse — this is a coverage read, not a score, and a 2/4 must not round to "pass".
function assessmentCell(correctCount, itemCount) {
  if (!itemCount) return CELL.untested;
  const ratio = correctCount / itemCount;
  if (ratio >= 0.8) return CELL.verified;
  if (ratio <= 0.34) return CELL.contradicted;
  return CELL.partial;
}

// --- how much evidence is enough to say anything at all --------------------
// A criterion sliced out of a 20-item paper typically gets 2–4 items. On
// 4-option items, 1-of-3 correct IS the chance baseline — indistinguishable
// from a candidate who guessed, and from one who knew it and was unlucky. So a
// per-criterion FAIL is never asserted from a thin assessment slice alone; it
// requires either a probe a human can read, or a slice big enough to mean
// something. Anything else is reported as "too little evidence", which is a
// statement about OUR test, not about the candidate (§3 rule 5).
const MIN_ITEMS_FOR_CALL = 3;
const MIN_ITEMS_FOR_FAIL = 4;
const FAIL_RATIO = 0.25;

const BUCKET = { proven: "proven", failed: "failed", insufficient: "insufficient" };

// Order matters: a live probe verdict is a human-readable exchange and outranks
// any item ratio, in both directions.
function classify({ probeVerdicts, correctCount, itemCount }) {
  if (probeVerdicts.includes("contradicted")) return BUCKET.failed;
  if (probeVerdicts.includes("verified")) return BUCKET.proven;
  if (itemCount >= MIN_ITEMS_FOR_CALL && correctCount === itemCount) return BUCKET.proven;
  if (itemCount >= MIN_ITEMS_FOR_FAIL && correctCount / itemCount <= FAIL_RATIO) return BUCKET.failed;
  return BUCKET.insufficient;
}

// Plain language, because the recruiter reads this and not the thresholds.
function evidenceSummary({ probeVerdicts, correctCount, itemCount, probeCount }) {
  const parts = [];
  if (itemCount > 0) parts.push(`${correctCount} of ${itemCount} assessment item${itemCount === 1 ? "" : "s"}`);
  if (probeVerdicts.includes("contradicted")) parts.push("contradicted in the interview");
  else if (probeVerdicts.includes("verified")) parts.push("verified in the interview");
  else if (probeCount > 0) parts.push("probed, no verdict reached");
  else parts.push("never probed in the interview");
  return parts.join(" · ");
}

// A probe with no verdict yet is untested, never "inconclusive" — the loop simply
// has not closed. Multiple probes on one criterion resolve to the worst outcome
// so a single contradiction is never averaged away (§3 rule 4).
const PROBE_CELL = { verified: CELL.verified, contradicted: CELL.contradicted, inconclusive: CELL.partial };
const CELL_SEVERITY = { contradicted: 0, partial: 1, absent: 2, untested: 3, verified: 4 };

function interviewCell(probes) {
  const resolved = probes.map((p) => (p.verdict ? PROBE_CELL[p.verdict] || CELL.partial : CELL.untested));
  if (resolved.length === 0) return CELL.untested;
  return resolved.sort((a, b) => CELL_SEVERITY[a] - CELL_SEVERITY[b])[0];
}

/**
 * @param {object[]} criterionFindings  pre-interview AtsAssessment.criterionFindings
 *                                      (carries id, label, kind, weight, status)
 * @param {object[]} perCriterion       AssessmentSession.result.perCriterion
 * @param {object[]} probes             aiInterview.probes
 * @returns {object|null} null when the rubric leg never ran, so older reports render unchanged.
 */
function buildCoverageMatrix({ criterionFindings, perCriterion, probes }) {
  const findings = (criterionFindings || []).filter((f) => f && f.criterionId);
  if (findings.length === 0) return null;

  const assessmentBy = new Map((perCriterion || []).map((c) => [c.criterionId, c]));
  const probesBy = new Map();
  for (const p of probes || []) {
    if (!p.criterionId) continue;
    if (!probesBy.has(p.criterionId)) probesBy.set(p.criterionId, []);
    probesBy.get(p.criterionId).push(p);
  }

  const rows = findings
    .map((f) => {
      const a = assessmentBy.get(f.criterionId);
      const cp = probesBy.get(f.criterionId) || [];
      const probeVerdicts = cp.map((p) => p.verdict).filter(Boolean);
      const correctCount = a?.correctCount || 0;
      const itemCount = a?.itemCount || 0;
      // The exchange that drove a failed call, so the row can link to it — a
      // verdict the recruiter cannot read for themselves is not evidence.
      const decidingProbe = cp.find((p) => p.verdict === "contradicted") || cp.find((p) => p.verdict === "verified") || null;

      return {
        criterionId: f.criterionId,
        // The label is the whole point: a recruiter must never be shown "c5".
        label: f.label || f.criterionId,
        kind: f.kind || "must_have",
        weight: typeof f.weight === "number" ? f.weight : 0,
        claimed: (f.supportingClaimIds || []).length > 0,
        resume: RESUME_CELL[f.status] || CELL.absent,
        assessment: a ? assessmentCell(correctCount, itemCount) : CELL.untested,
        assessmentDetail: a ? { correctCount, itemCount } : null,
        interview: interviewCell(cp),
        probeCount: cp.length,
        bucket: classify({ probeVerdicts, correctCount, itemCount }),
        evidence: evidenceSummary({ probeVerdicts, correctCount, itemCount, probeCount: cp.length }),
        // True when the assessment slice was too thin to support any call on its
        // own — surfaced so the gap reads as OUR test being underpowered.
        underpowered: itemCount > 0 && itemCount < MIN_ITEMS_FOR_FAIL && probeVerdicts.length === 0,
        decidingProbe: decidingProbe
          ? { question: decidingProbe.question, answerQuote: decidingProbe.answerQuote || "", turnIndex: decidingProbe.turnIndex ?? null }
          : null,
      };
    })
    .sort((a, b) => b.weight - a.weight);

  const weightOf = (bucket) => Math.round(rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.weight, 0) * 100) / 100;
  const group = (bucket) => ({ rows: rows.filter((r) => r.bucket === bucket), weight: weightOf(bucket) });

  return {
    rows,
    buckets: { proven: group(BUCKET.proven), failed: group(BUCKET.failed), insufficient: group(BUCKET.insufficient) },
    totals: {
      criteria: rows.length,
      // How much of what this role says it cares about we cannot speak to. This
      // is the honest headline, and it is a statement about the assessment.
      insufficientWeight: weightOf(BUCKET.insufficient),
      failedWeight: weightOf(BUCKET.failed),
      provenWeight: weightOf(BUCKET.proven),
      neverProbed: rows.filter((r) => r.probeCount === 0).length,
      underpoweredCriteria: rows.filter((r) => r.underpowered).length,
      minItemsForCall: MIN_ITEMS_FOR_FAIL,
    },
  };
}

// ---------------------------------------------------------------------------
// Session quality
// ---------------------------------------------------------------------------
// §3 rule 5: a degraded session must be labelled everywhere it surfaces, and must
// never be reported as if it were a clean read. These thresholds detect the
// signature of a broken audio path — long recordings that transcribe to almost
// nothing, near-silent turns, and repeated "can you repeat that".

// Calibrated against real sessions: answers that were genuinely attempted ran
// 111–125 wpm at a 0.56–0.57 pause ratio, while every non-answer sat below 35 wpm
// at 0.79+. These thresholds sit in that gap, so a slow-but-real answer is not
// flagged and an open mic producing nothing is.
const SILENCE_PAUSE_RATIO = 0.8;
const LOW_DELIVERY = 10;
// A turn that captured real audio but almost no speech is the clearest tell.
// Measured as rate, not raw word count, so a long rambling non-answer
// ("could you repeat… could you repeat…") is caught alongside a silent one.
const STALLED_MIN_AUDIO_MS = 8000;
const STALLED_MAX_WPM = 35;
const REPEAT_RE = /\b(repeat|say (that|it) again|come again|couldn'?t hear|can'?t hear|pardon)\b/i;

function analyseTurnQuality(turns) {
  return (turns || [])
    .filter((t) => t.role === "candidate")
    .map((t, index) => {
      const words = wordCount(t.text);
      const audioMs = t.audioDurationMs || 0;
      const pauseRatio = t.acoustic?.pauseRatio ?? null;
      const deliveryScore = t.acoustic?.deliveryScore ?? null;
      // Prefer the rate the ASR reported; fall back to deriving it so a turn
      // without acoustics is still assessable.
      const wpm = t.acoustic?.wordsPerMinute ?? (audioMs > 0 ? (words / (audioMs / 60000)) : null);
      const flags = [];
      if (audioMs >= STALLED_MIN_AUDIO_MS && wpm != null && wpm < STALLED_MAX_WPM) flags.push("stalled");
      if (pauseRatio != null && pauseRatio >= SILENCE_PAUSE_RATIO) flags.push("mostly_silence");
      if (deliveryScore != null && deliveryScore <= LOW_DELIVERY) flags.push("low_delivery");
      if (REPEAT_RE.test(t.text || "")) flags.push("asked_to_repeat");
      return {
        index,
        words,
        audioMs,
        wpm: wpm == null ? null : Math.round(wpm),
        pauseRatio,
        deliveryScore,
        answerScore: t.answerScore ?? null,
        flags,
        degraded: flags.length > 0,
      };
    });
}

/**
 * Whether this interview is a trustworthy read at all. When it is not, the caller
 * must suppress the hire/no-hire recommendation rather than print it with a caveat
 * — an unreliable recommendation shown quietly is still shown.
 */
function computeSessionQuality(turns) {
  const perTurn = analyseTurnQuality(turns);
  const total = perTurn.length;
  if (total === 0) return { degraded: false, perTurn, total: 0, degradedCount: 0, repeatRequests: 0, reasons: [] };

  const degradedCount = perTurn.filter((t) => t.degraded).length;
  const repeatRequests = perTurn.filter((t) => t.flags.includes("asked_to_repeat")).length;
  const stalled = perTurn.filter((t) => t.flags.includes("stalled")).length;
  const degradedRatio = degradedCount / total;

  const reasons = [];
  if (stalled >= 2) reasons.push(`${stalled} answers recorded several seconds of audio but produced almost no words`);
  if (repeatRequests >= 2) reasons.push(`the candidate asked for a question to be repeated ${repeatRequests} times`);
  if (degradedRatio >= 0.4) reasons.push(`${degradedCount} of ${total} answers show a degraded audio signature`);

  return {
    degraded: reasons.length > 0,
    // Suppression is the point: with a broken signal we cannot tell "could not
    // answer" from "could not hear", and guessing between them is exactly the
    // judgement that must go to a human.
    suppressRecommendation: reasons.length > 0,
    perTurn,
    total,
    degradedCount,
    repeatRequests,
    stalled,
    reasons,
  };
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
  CELL,
  BUCKET,
  MIN_ITEMS_FOR_CALL,
  MIN_ITEMS_FOR_FAIL,
  buildCoverageMatrix,
  analyseTurnQuality,
  computeSessionQuality,
};
