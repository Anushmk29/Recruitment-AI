// Renders an AI interview report (the same shape controllers/candidateController.buildInterviewReport
// returns) into a downloadable PDF, using the zero-dep utils/pdf.js builder.

const { PdfDoc } = require("../utils/pdf");

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

  if (!report.hasInterview) {
    heading(doc, "Interview status");
    doc.text(
      "This candidate has not completed the AI interview yet. The full evaluation and transcript will appear here once the interview is finished.",
      { size: 11, color: MUTED }
    );
    footer(doc, report);
    return doc.render();
  }

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

  // --- Claim Verification (Phase 8) — "is this résumé true?", at a glance ---
  claimVerificationSection(doc, report.claimVerification);

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

// §5: explicit action verb + one-line justification, the last thing before the footer.
function recommendedActionLine(doc, action) {
  if (!action) return;
  doc.moveDown(6);
  doc.hr({ gapAfter: 6 });
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
      doc.text(`•  ${row.label} — ${row.count}× (${row.severity})`, { size: 11, color: INK, indent: 4, lineGap: 3 });
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
