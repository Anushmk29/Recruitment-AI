// Renders an AI interview report (the same shape controllers/candidateController.buildInterviewReport
// returns) into a downloadable PDF, using the zero-dep utils/pdf.js builder.

const { PdfDoc, sanitize } = require("../utils/pdf");

const INK = [0.09, 0.11, 0.15];
const MUTED = [0.42, 0.45, 0.5];
const BRAND = [0.16, 0.23, 0.42];
const WARN = [0.7, 0.45, 0.05];

const RECOMMENDATION = {
  strong_hire: "Strong Hire",
  hire: "Hire",
  maybe: "Maybe",
  no_hire: "No Hire",
};

const VERDICT_COLORS = {
  CLEAR_REJECT: [0.86, 0.15, 0.15],
  REVIEW: [0.85, 0.55, 0.06],
  ADVANCE: [0.11, 0.6, 0.4],
};
const VERDICT_LABELS = {
  CLEAR_REJECT: "CLEAR REJECT",
  REVIEW: "REVIEW",
  ADVANCE: "ADVANCE",
};

const RISK_BAND = { low: "Low", medium: "Medium", high: "High" };
const IDENTITY_STATUS = { match: "Matched the identity photo", mismatch: "Did NOT match the identity photo", unknown: "Not checked" };
const COMPETENCY_LABELS = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  system_design: "System design",
  debugging: "Debugging",
  learning: "Learning",
  general: "General",
};

function fmtWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// Section heading with a small brand tick + generous spacing.
function heading(doc, label) {
  doc.moveDown(6);
  doc.ensure(28);
  doc.text(label, { size: 13, bold: true, color: INK, gap: 2 });
  doc.hr({ gapBefore: 2, gapAfter: 10 });
}

function labelValue(doc, label, value) {
  doc.ensure(16);
  const y = doc.y;
  doc._line(doc.left, y - 10, label, 10, false, MUTED);
  doc._line(doc.left, y - 10, String(value == null || value === "" ? "—" : value), 10, true, INK, "right", doc.contentWidth);
  doc.y -= 18;
}

function warningLine(doc, text) {
  doc.ensure(20);
  doc.text(text, { size: 10, bold: true, color: WARN, gap: 6 });
}

function identityStatusLabel(identityMatch) {
  return IDENTITY_STATUS[identityMatch?.status] || IDENTITY_STATUS.unknown;
}

// §1: the verdict banner — drawn full-bleed at the very top of the first page, above
// the brand header band. Color-coded so a recruiter reads the call before anything else.
function verdictBanner(doc, topY, verdict) {
  const bandH = 60;
  const color = VERDICT_COLORS[verdict.verdict] || VERDICT_COLORS.REVIEW;
  doc._fill(0, topY, doc.pageWidth, bandH, color);
  doc._line(doc.left, topY - 22, `VERDICT: ${VERDICT_LABELS[verdict.verdict] || verdict.verdict}`, 15, true, [1, 1, 1]);
  doc._line(doc.left, topY - 39, verdict.reason, 10, false, [1, 1, 1]);
  doc._line(doc.left, topY - 53, `Confidence: ${verdict.confidence}`, 9, true, [0.92, 0.95, 1]);
  return topY - bandH;
}

function brandHeaderBand(doc, topY, report) {
  const bandH = 66;
  doc._fill(0, topY, doc.pageWidth, bandH, BRAND);
  doc._line(doc.left, topY - 30, "AI Interview Report", 20, true, [1, 1, 1]);
  const sub = `${report.candidate?.name || "Candidate"}${report.job?.title ? "  ·  " + report.job.title : ""}`;
  doc._line(doc.left, topY - 50, sub, 11, false, [0.82, 0.86, 0.94]);
  return topY - bandH;
}

// §3: prominent, un-buried validity badge — every numeric score downstream is either
// real or explicitly a placeholder; this is where the recruiter learns which.
function validityBadge(doc, iv) {
  doc.ensure(20);
  if (iv.engine === "fallback") {
    doc.text(
      "FALLBACK ENGINE — the real AI evaluation did not run. Every score below is a PLACEHOLDER from answer-completeness heuristics, not a real evaluation. A human must review the transcript directly.",
      { size: 10, bold: true, color: WARN, gap: 8 }
    );
  } else {
    doc.text("Real AI evaluation engine ran for this interview.", { size: 9, color: MUTED, gap: 8 });
  }
}

function buildReportPdf(report) {
  const doc = new PdfDoc();
  const iv = report.hasInterview ? report.interview || {} : null;

  let topY = doc.pageHeight;
  if (iv?.verdict) topY = verdictBanner(doc, topY, iv.verdict);
  topY = brandHeaderBand(doc, topY, report);
  doc.y = topY - 22;

  if (iv) validityBadge(doc, iv);

  // --- Overview ---
  labelValue(doc, "Candidate", report.candidate?.name);
  if (report.candidate?.email) labelValue(doc, "Email", report.candidate.email);
  if (report.job?.title) labelValue(doc, "Position", report.job.title + (report.job.department ? ` (${report.job.department})` : ""));
  labelValue(doc, "Current stage", report.stageLabel || report.stage);
  if (report.decisionTrail) {
    labelValue(
      doc,
      "Decided by",
      `${report.decisionTrail.by || "system"} · ${fmtWhen(report.decisionTrail.at)}${report.decisionTrail.note ? " — " + report.decisionTrail.note : ""}`
    );
  }

  // One label map for the whole document, so no section prints a bare "c5".
  const criterionLabels = Object.fromEntries((report.coverage?.rows || []).map((r) => [r.criterionId, r.label]));

  if (!report.hasInterview) {
    heading(doc, "Interview status");
    doc.text(
      "This candidate has not completed the AI interview yet. The full evaluation and transcript will appear here once the interview is finished.",
      { size: 11, color: MUTED }
    );
    // Coverage spans résumé + assessment, so it is meaningful with no interview.
    coverageSection(doc, report.coverage);
    // The assessment often completes before the interview — show what exists.
    assessmentSection(doc, report.assessment, criterionLabels);
    footer(doc, report);
    return doc.render();
  }

  // Above everything else: a degraded session invalidates what follows it.
  sessionQualitySection(doc, iv.sessionQuality);

  // §4: identity + duration flags surfaced immediately, not buried in Integrity.
  labelValue(doc, "Identity check", identityStatusLabel(report.proctoring?.identityMatch));
  if (iv.durationFlag?.abnormallyShort) {
    warningLine(
      doc,
      `Abnormally short session — averaging ${iv.durationFlag.secondsPerQuestion}s per question (${iv.durationFlag.totalSeconds}s total for ${iv.questionCount} questions).`
    );
  }

  const ev = iv.evaluation;

  labelValue(doc, "Interview status", iv.status);
  labelValue(doc, "Format", iv.modality === "voice" ? "Voice (spoken answers)" : "Text");
  labelValue(doc, "Engine", iv.engine === "fallback" ? "Deterministic fallback (external AI not used)" : "AI");
  labelValue(doc, "Questions", `${iv.questionCount ?? "—"} / ${iv.maxQuestions ?? "—"}`);
  if (iv.startedAt) labelValue(doc, "Started", fmtWhen(iv.startedAt));
  if (iv.completedAt) labelValue(doc, "Completed", fmtWhen(iv.completedAt));
  if (iv.substance) labelValue(doc, "Responsive answers", `${iv.substance.responsiveCount} / ${iv.substance.totalAnswers}`);
  // Rule 5 — uncertainty is visible on the PDF, not only on the screen. A printed score with no
  // indication of how much of the interview it covers is the version most likely to end up in
  // front of someone with no access to the transcript behind it.
  if (iv.substance?.declinedCount > 0) {
    labelValue(
      doc,
      "Declined questions",
      `${iv.substance.declinedCount} (asked, candidate stated they could not answer — excluded from the scores below)`
    );
  }
  if (iv.endedEarly) {
    labelValue(doc, "Ended early", "By the candidate — the interview was not completed and no automated recommendation applies");
  }

  // --- Evaluation ---
  heading(doc, "Evaluation");
  if (ev) {
    if (RECOMMENDATION[ev.recommendation]) {
      // Never render the raw "review" enum here — the verdict banner above is the
      // single source of truth for the headline call; this row only ever shows a
      // real hire-signal recommendation.
      labelValue(doc, "Recommendation", RECOMMENDATION[ev.recommendation]);
    }
    const isFallback = ev.generatedBy === "fallback";
    doc.moveDown(2);
    doc.text(`Overall score: ${ev.overallScore ?? "—"}/100${isFallback ? "  (PLACEHOLDER)" : ""}`, {
      size: 14,
      bold: true,
      color: isFallback ? MUTED : INK,
      gap: 8,
    });

    if (iv.competencyTriplet) {
      doc.scoreBar("Communication", iv.competencyTriplet.communication);
      doc.scoreBar("Technical knowledge", iv.competencyTriplet.technicalKnowledge);
      doc.scoreBar("Problem solving", iv.competencyTriplet.problemSolving);
    } else {
      doc.text(
        isFallback
          ? "Communication / Technical knowledge / Problem solving: PLACEHOLDER — not a real evaluation (deterministic fallback)."
          : "Communication / Technical knowledge / Problem solving: not separately measured for this interview.",
        { size: 10, color: MUTED, gap: 8 }
      );
    }

    if (ev.summary) {
      doc.moveDown(4);
      doc.text("Summary", { size: 10, bold: true, color: MUTED, gap: 3 });
      doc.text(ev.summary, { size: 11, color: INK });
    }
    bulletList(doc, "Strengths", ev.strengths);
    bulletList(doc, "Weaknesses", ev.weaknesses);
    bulletList(doc, "Skills to probe", ev.missingSkills);

    signalQualitySection(doc, ev);

    doc.moveDown(6);
    doc.text(
      `Generated by ${ev.generatedBy === "fallback" ? "deterministic fallback (AI provider not configured)" : "AI"}` +
        (ev.generatedAt ? ` · ${fmtWhen(ev.generatedAt)}` : ""),
      { size: 9, color: MUTED }
    );
  } else {
    doc.text("Evaluation not available yet.", { size: 11, color: MUTED });
  }

  // --- Evidence coverage: what the role required vs what was actually tested ---
  coverageSection(doc, report.coverage);

  // --- Answer-by-answer quality (makes a run of dead turns visible) ---
  turnQualitySection(doc, iv.sessionQuality);

  // --- Claim Verification (Phase 8) — "is this résumé true?", at a glance ---
  claimVerificationSection(doc, report.claimVerification);

  // --- Skills Assessment (A3.5) — the pre-interview assessment leg, with the
  // provenance that makes its number defensible ---
  assessmentSection(doc, report.assessment, criterionLabels);

  // --- Competency breakdown (§9) ---
  competencyTable(doc, iv.competencyTable);

  // --- Integrity / proctoring (secondary — after the competency verdict) ---
  integritySection(doc, report.proctoring, report.evidenceClips);

  // --- Transcript ---
  heading(doc, "Transcript");
  const turns = iv.transcript || [];
  if (turns.length === 0) {
    doc.text("No transcript recorded.", { size: 11, color: MUTED });
  } else {
    for (const t of turns) {
      if (!t.text) continue;
      let meta = null;
      if (t.role === "candidate" && t.wordCount != null) {
        const dur = t.durationSec != null ? `${t.durationSec}s` : "duration unknown";
        meta = `${t.wordCount} word${t.wordCount === 1 ? "" : "s"} · ${dur} · ${t.responsive ? "Responsive" : "Non-responsive"}`;
      }
      doc.bubble(t.role, t.text, t.answerScore, { meta });
    }
  }

  // §5: recommended next action, stated explicitly, right before the footer.
  recommendedActionLine(doc, iv.recommendedAction);

  footer(doc, report);
  return doc.render();
}

// §6: delivery/confidence are voice-only signal-quality measurements (pace, filler
// rate), not competency — kept clearly secondary and separately labelled to avoid
// them reading as headline scores (accent/audio bias risk on ESL/voice interviews).
function signalQualitySection(doc, ev) {
  if (ev.delivery == null && ev.confidence == null) return;
  doc.moveDown(6);
  doc.text("Signal quality (secondary — voice delivery, not competency)", { size: 9, bold: true, color: MUTED, gap: 4 });
  if (ev.delivery != null) doc.scoreBar("Delivery (voice)", ev.delivery);
  if (ev.confidence != null) doc.scoreBar("Confidence (voice)", ev.confidence);
  doc.text(
    "These measure speaking pace and fluency, not technical ability, and can reflect accent or audio quality rather than skill — weigh them lightly.",
    { size: 8, color: MUTED }
  );
}

// §9: one row per question, tagged with the competency it probes and a quoted
// evidence snippet, so a recruiter sees where the candidate is strong/weak rather
// than just one global number.
function competencyTable(doc, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  heading(doc, "Competency breakdown");
  for (const r of rows) {
    doc.ensure(30);
    const label = COMPETENCY_LABELS[r.competency] || r.competency;
    doc.text(`${label}  —  ${r.score != null ? r.score + "/100" : "—"}`, { size: 11, bold: true, color: INK, gap: 2 });
    if (r.evidence) doc.text(`"${r.evidence}"`, { size: 9, color: MUTED, indent: 4, gap: 6 });
  }
}

// Phase 8.6 — Claim Verification: each probed résumé claim with its verdict,
// the résumé quote and the transcript quote side by side, plus the pre→post
// score delta the verdicts produced. Hidden entirely when the loop didn't run.
const PROBE_VERDICT = {
  verified: { label: "VERIFIED in interview", color: [0.11, 0.6, 0.4] },
  contradicted: { label: "CONTRADICTED in interview", color: [0.86, 0.15, 0.15] },
  inconclusive: { label: "INCONCLUSIVE", color: [0.85, 0.55, 0.06] },
};

function claimVerificationSection(doc, cv) {
  if (!cv || !Array.isArray(cv.probes) || cv.probes.length === 0) return;
  heading(doc, "Claim Verification");

  if (cv.scoreDelta) {
    const d = cv.scoreDelta.delta;
    const sign = d > 0 ? "+" : "";
    doc.text(
      `Screening score ${cv.scoreDelta.pre.overallScore} → ${cv.scoreDelta.post.overallScore} after the interview (${sign}${d} points from claim verdicts).`,
      { size: 11, bold: true, color: INK, gap: 8 }
    );
  }

  for (const p of cv.probes) {
    doc.ensure(48);
    const v = p.verdict ? PROBE_VERDICT[p.verdict] : null;
    doc.text(v ? v.label : p.status === "asked" ? "Asked — verdict pending" : "Not covered in this interview", {
      size: 10,
      bold: true,
      color: v ? v.color : MUTED,
      gap: 2,
    });
    if (p.resumeQuote) doc.text(`Resume: "${p.resumeQuote}"`, { size: 9, color: MUTED, indent: 4, gap: 2 });
    doc.text(`Asked: ${p.question}`, { size: 9, color: INK, indent: 4, gap: 2 });
    if (p.answerQuote) doc.text(`Answer: "${p.answerQuote}"`, { size: 9, color: INK, indent: 4, gap: 2 });
    if (p.verdictReasoning) doc.text(p.verdictReasoning, { size: 8, color: MUTED, indent: 4, gap: 6 });
    else doc.moveDown(4);
  }

  doc.text(
    "A contradicted claim is evidence for a human reviewer, never an automatic rejection — both quotes are shown so you can judge the exchange yourself.",
    { size: 8, color: MUTED }
  );
}

// A3.5 — Skills Assessment: the pre-interview assessment result, or the
// recruiter's explicit skip. Hidden entirely when the engine never touched this
// candidate. Every number ships with its provenance: the difficulty tier and the
// exact basis it was derived from, per-criterion counts against the frozen
// rubric, targeted résumé-claim verdicts, and the scorer version +
// reproducibility hash that let anyone re-derive the score.
// ---------------------------------------------------------------------------
// Evidence coverage matrix (screen parity: admin/src/pages/InterviewReport.jsx)
// ---------------------------------------------------------------------------
// Same diverging scale as the screen — emerald/red poles, neutral gray midpoint,
// unfilled for "not tested" — and the same glyphs, because print and CVD readers
// need the mark, not the hue. Built from rectangles so one design serves both.
const BUCKET_PDF = {
  failed: { title: "FAILED", blurb: "The candidate could not support this.", accent: [0.86, 0.15, 0.15] },
  proven: { title: "PROVEN", blurb: "Demonstrated under test.", accent: [0.02, 0.59, 0.41] },
  insufficient: {
    title: "TOO LITTLE EVIDENCE",
    blurb: "Our test was too thin to call this either way — not a mark against the candidate.",
    accent: [0.55, 0.58, 0.63],
  },
};

function bucketBlock(doc, key, group, footNote) {
  if (!group?.rows?.length) return;
  const meta = BUCKET_PDF[key];
  doc.ensure(46);
  doc.moveDown(4);
  // A colour bar carries the group; the written title carries it in greyscale.
  doc._fill(doc.left, doc.y, 3, 11, meta.accent);
  doc._line(doc.left + 8, doc.y - 9, meta.title, 10, true, meta.accent);
  doc._line(doc.left, doc.y - 9, `${Math.round(group.weight * 100)}% of role`, 9, true, MUTED, "right", doc.contentWidth);
  doc.y -= 14;
  doc.text(meta.blurb, { size: 8, color: MUTED, gap: 3 });

  for (const r of group.rows) {
    doc.ensure(26);
    doc.text(`${Math.round(r.weight * 100)}%   ${r.label}`, { size: 10, bold: true, color: INK, indent: 8, lineGap: 1 });
    doc.text(r.evidence, { size: 9, color: MUTED, indent: 8, lineGap: 1 });
    if (r.decidingProbe?.answerQuote) {
      doc.text(`"${r.decidingProbe.answerQuote}"`, { size: 8, color: MUTED, indent: 14, lineGap: 1 });
    }
    doc.moveDown(3);
  }
  if (footNote) doc.text(footNote, { size: 8, bold: true, color: MUTED, gap: 2 });
}

function coverageSection(doc, coverage) {
  if (!coverage?.buckets) return;
  heading(doc, "What We Actually Know");
  doc.text(
    `Every requirement for this role${coverage.rubricVersion != null ? ` (rubric v${coverage.rubricVersion})` : ""}, grouped by how strong the evidence is. Percentages are each requirement's weight in the rubric.`,
    { size: 9, color: MUTED, gap: 4 }
  );

  bucketBlock(doc, "failed", coverage.buckets.failed);
  bucketBlock(doc, "proven", coverage.buckets.proven);
  bucketBlock(doc, "insufficient", coverage.buckets.insufficient, "These are the questions for the next round.");

  const t = coverage.totals;
  if (t.underpoweredCriteria > 0) {
    doc.moveDown(4);
    doc.text(
      `${t.underpoweredCriteria} of ${t.criteria} requirements were tested with fewer than ${t.minItemsForCall} items and never probed in the interview. That is too little to score either way — on a handful of multiple-choice items a wrong answer is indistinguishable from a guess. Widen the paper or probe these live before treating them as weaknesses.`,
      { size: 8, color: MUTED }
    );
  }
}

// §3 rule 5 — the degraded-session label travels with the report into print.
function sessionQualitySection(doc, quality) {
  if (!quality?.degraded) return;
  doc.ensure(50);
  doc.moveDown(6);
  const top = doc.y;
  doc._fill(doc.left, top, doc.contentWidth, 3, [0.85, 0.55, 0.06]);
  doc.y -= 8;
  doc.text("DEGRADED SESSION — RECOMMENDATION WITHHELD", { size: 11, bold: true, color: [0.7, 0.45, 0.05], gap: 3 });
  for (const r of quality.reasons) {
    doc.text(`•  ${sanitize(r)}`, { size: 10, color: INK, indent: 4, lineGap: 2 });
  }
  doc.text(
    "On a broken audio signal an unanswered question cannot be told apart from an unheard one. Scores in this report are shown for transparency and are not a measure of this candidate.",
    { size: 9, color: MUTED, gap: 4 }
  );
  doc._fill(doc.left, doc.y + 2, doc.contentWidth, 1, [0.9, 0.91, 0.93]);
  doc.moveDown(6);
}

// Answer-by-answer quality strip — the view that makes a run of near-silent
// answers visible instead of averaging it into one number.
function turnQualitySection(doc, quality) {
  if (!quality?.perTurn?.length) return;
  heading(doc, "Answer-by-Answer Quality");
  doc.text(`${quality.degradedCount} of ${quality.total} answers show a degraded audio signature.`, {
    size: 9,
    color: MUTED,
    gap: 6,
  });

  const barW = 9;
  const gap = 3;
  const maxH = 42;
  const perRow = Math.floor(doc.contentWidth / (barW + gap));
  const rows = [];
  for (let i = 0; i < quality.perTurn.length; i += perRow) rows.push(quality.perTurn.slice(i, i + perRow));

  for (const group of rows) {
    doc.ensure(maxH + 16);
    const baseline = doc.y - maxH;
    group.forEach((t, i) => {
      const x = doc.left + i * (barW + gap);
      doc._fill(x, doc.y, barW, maxH, [0.94, 0.95, 0.96]);
      const h = Math.max(2, Math.min(maxH, ((t.answerScore ?? 0) / 100) * maxH));
      doc._fill(x, baseline + h, barW, h, t.degraded ? [0.86, 0.15, 0.15] : BRAND);
      // Secondary encoding, so the flag survives greyscale printing.
      if (t.degraded) doc._line(x, baseline - 9, "!", 7, true, [0.86, 0.15, 0.15], "center", barW);
    });
    doc.y -= maxH + 14;
  }
  doc.text("Bar height = answer score.  ! = degraded audio signature.", { size: 8, color: MUTED });
}

const ASSESSMENT_VERDICT = {
  verified: { label: "VERIFIED by assessment", color: [0.11, 0.6, 0.4] },
  contradicted: { label: "CONTRADICTED by assessment", color: [0.86, 0.15, 0.15] },
  inconclusive: { label: "INCONCLUSIVE", color: [0.85, 0.55, 0.06] },
};
const TIER_SOURCE = {
  claim_derived: "derived from résumé claims",
  recruiter_override: "set by the recruiter",
  paper_fixed: "fixed for this paper",
};
const SESSION_STATUS = {
  scheduled: "Invitation sent — not started yet",
  in_progress: "In progress",
  paused: "Paused (integrity soft-lock — awaiting human review)",
  completed: "Completed",
  expired: "Window expired",
  cancelled: "Cancelled by the recruiter",
};

function assessmentSection(doc, a, criterionLabels = {}) {
  if (!a) return;
  const labelFor = (id) => criterionLabels[id] || id;
  heading(doc, "Skills Assessment");

  // An explicit skip is a recorded human decision, not a missing assessment.
  if (a.decision?.action === "skipped") {
    doc.text(
      `Skipped by ${a.decision.byName || "a recruiter"} on ${fmtWhen(a.decision.at)} — this candidate was sent directly to the AI interview. This is a recorded human decision, not a gap in the data.`,
      { size: 11, color: INK }
    );
    return;
  }

  if (!a.session) {
    doc.text("An assessment decision was recorded but no session exists yet.", { size: 11, color: MUTED });
    return;
  }

  const t = a.session.difficultyTier;
  if (t) {
    doc.text(
      `Difficulty: ${t.value.toUpperCase()} — ${TIER_SOURCE[t.source] || t.source}${t.basis ? ` (${t.basis})` : ""}`,
      { size: 10, bold: true, color: INK, gap: 6 }
    );
  }

  const r = a.session.result;
  if (!r) {
    // Live-but-unscored renders as its status — never as a placeholder score.
    doc.text(`Status: ${SESSION_STATUS[a.session.status] || a.session.status}. No scored result yet.`, { size: 11, color: MUTED });
    return;
  }

  doc.text(`Score: ${r.totalCorrect}/${r.totalItems} items correct`, { size: 14, bold: true, color: INK, gap: 4 });
  if (r.completedBy === "expiry") {
    warningLine(doc, "PARTIAL — the window closed before the candidate submitted; only the work completed by then is scored. Treat as incomplete evidence.");
  }

  if (Array.isArray(r.perCriterion) && r.perCriterion.length > 0) {
    doc.moveDown(2);
    doc.text("By rubric criterion", { size: 10, bold: true, color: MUTED, gap: 3 });
    for (const c of r.perCriterion) {
      doc.text(`•  ${sanitize(labelFor(c.criterionId))} — ${c.correctCount}/${c.itemCount}`, { size: 11, color: INK, indent: 4, lineGap: 3 });
    }
  }

  if (Array.isArray(r.claimVerdicts) && r.claimVerdicts.length > 0) {
    doc.moveDown(4);
    doc.text("Résumé-claim verdicts (items targeted at unproven claims)", { size: 10, bold: true, color: MUTED, gap: 3 });
    for (const v of r.claimVerdicts) {
      doc.ensure(24);
      const badge = ASSESSMENT_VERDICT[v.verdict] || ASSESSMENT_VERDICT.inconclusive;
      doc.text(badge.label, { size: 10, bold: true, color: badge.color, gap: 1 });
      doc.text(`${sanitize(labelFor(v.criterionId))} — ${v.correctCount}/${v.itemCount} targeted items correct`, {
        size: 9,
        color: MUTED,
        indent: 4,
        gap: 4,
      });
    }
    doc.text(
      "A contradicted claim is evidence for a human reviewer, never an automatic rejection.",
      { size: 8, color: MUTED, gap: 4 }
    );
  }

  doc.moveDown(4);
  doc.text(
    `Scored ${fmtWhen(r.scoredAt)} · scorer ${r.scorerVersion || "—"} · reproducibility ${String(r.reproducibilityHash || "").slice(0, 16) || "—"}…  ` +
      "The score was computed deterministically by code from the frozen answer key — no AI in the scoring path. The hash lets an auditor re-derive this exact score from the archived paper and responses.",
    { size: 8, color: MUTED }
  );
}

// §5: explicit action verb + one-line justification, the last thing before the footer.
function recommendedActionLine(doc, action) {
  if (!action) return;
  doc.moveDown(6);
  doc.hr({ gapAfter: 6 });
  // A withheld recommendation is labelled as withheld, not printed as a decision.
  if (action.suppressed) {
    doc.text(`Recommendation withheld — ${action.action}`, { size: 12, bold: true, color: WARN, gap: 2 });
    doc.text(action.justification, { size: 10, color: MUTED });
    return;
  }
  doc.text(`Recommended action: ${action.action}`, { size: 12, bold: true, color: INK, gap: 2 });
  doc.text(action.justification, { size: 10, color: MUTED });
}

// Integrity / proctoring block. Advisory — states plainly that it's for human judgement, not an
// automated decision. Hidden entirely when no proctoring data was recorded. Uses the
// identity-gated display risk (§8) rather than the raw score, and shows a plausible
// benign explanation per flag so recruiters don't over-anchor on "High".
function integritySection(doc, p, evidenceClips) {
  if (!p) return;
  heading(doc, "Integrity & Proctoring");

  labelValue(doc, "Integrity risk", `${p.displayRiskScore ?? 0}/100  (${RISK_BAND[p.displayRiskBand] || "Low"})`);
  if (p.identityGateNote) {
    doc.text(p.identityGateNote, { size: 9, bold: true, color: WARN, gap: 6 });
  }
  if (p.identityMatch?.status) labelValue(doc, "Identity check", identityStatusLabel(p.identityMatch));
  labelValue(doc, "Camera monitoring", p.visionEnabled ? "On (in-browser face detection)" : "Off (browser signals only)");
  if (p.consent) {
    labelValue(doc, "Candidate consent", p.consent.given ? "Given" : p.consent.declined ? "Declined" : "—");
  }
  labelValue(doc, "Total flags", String(p.totalEvents ?? 0));

  if (Array.isArray(p.breakdown) && p.breakdown.length > 0) {
    doc.moveDown(4);
    doc.text("Flags recorded", { size: 10, bold: true, color: MUTED, gap: 3 });
    for (const row of p.breakdown) {
      // A row that measures OUR camera view rather than the candidate is labelled as such here too.
      // The screen, the API and the PDF have to agree: rendering an unobservable stretch of the
      // session with a severity beside it invites a reader to treat it as a finding.
      const qualifier = row.scored === false ? "not scored — recording conditions" : row.severity;
      doc.text(`•  ${row.label} — ${row.count}× (${qualifier})`, { size: 11, color: INK, indent: 4, lineGap: 3 });
      if (row.benignExplanation) {
        doc.text(row.benignExplanation, { size: 8, color: MUTED, indent: 12, lineGap: 2, gap: 2 });
      }
    }
  }

  // Phase 14.5 — the PDF notes that reviewable evidence exists; the clips
  // themselves play only in the dashboard, where every view is audit-logged.
  if (Array.isArray(evidenceClips) && evidenceClips.length > 0) {
    doc.moveDown(4);
    doc.text(
      `Evidence clips: ${evidenceClips.length} short clip(s) were captured for high-severity flags (consent-gated, event-anchored — never continuous recording). Review them in the dashboard; each view is audit-logged.`,
      { size: 9, bold: true, color: INK }
    );
  }

  doc.moveDown(4);
  doc.text(
    "Integrity flags are advisory signals for a human reviewer — they are not proof of misconduct and never on their own decide an outcome.",
    { size: 9, color: MUTED }
  );
}

function bulletList(doc, title, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  doc.moveDown(4);
  doc.text(title, { size: 10, bold: true, color: MUTED, gap: 3 });
  for (const it of items) {
    if (it == null || it === "") continue;
    doc.text("•  " + it, { size: 11, color: INK, indent: 4, lineGap: 3 });
  }
}

function footer(doc, report) {
  doc.moveDown(14);
  doc.hr({ gapAfter: 8 });
  doc.text(
    `Confidential — generated ${fmtWhen(new Date())} for internal hiring use. Handle in line with your data-retention policy.`,
    { size: 8, color: MUTED }
  );
}

module.exports = { buildReportPdf };
