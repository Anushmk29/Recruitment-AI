const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const User = require("../models/User");
const InterviewSession = require("../models/InterviewSession");
const storageService = require("../services/storageService");
const { runAtsForCandidate } = require("../services/atsService");
const { notifyAdmin, notifyCandidate } = require("../services/notificationService");
const { applyTransition } = require("../services/pipelineService");
const { allowedNextStages, stageLabel } = require("../utils/pipeline");
const proctoring = require("../utils/proctoring");
const {
  computeAnswerSubstance,
  computeDurationFlag,
  buildCompetencyTable,
  computeVerdict,
  recommendedAction,
  competencyTripletOrNull,
} = require("../utils/interviewReportEngine");

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function truthy(v) {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

async function applyToJob(req, res) {
  const { id: jobIdOrSlug } = req.params;
  const { name, email, phone, location, linkedinUrl, portfolioUrl, experience, education, skills, projects, certificates } =
    req.body;
  const consentAi = truthy(req.body.consentAiProcessing);
  const consentData = truthy(req.body.consentDataProcessing);

  const job = await Job.findByIdOrSlug(jobIdOrSlug);
  if (!job || job.status !== "published") {
    return res.status(404).json({ error: "Job not found or not accepting applications" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Resume file is required" });
  }
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Persist the resume through the storage abstraction with a tenant-partitioned key,
  // so it's reachable from every instance (S3/MinIO) and never leaks across tenants.
  const resumeKey = await storageService.putObject({
    buffer: req.file.buffer,
    key: storageService.buildKey("resumes", { company: job.company, originalName: req.file.originalname }),
    contentType: req.file.mimetype,
  });

  const candidate = await Candidate.create({
    job: job._id,
    company: job.company,
    basicDetails: { name, email, phone, location, linkedinUrl, portfolioUrl },
    experience: parseJsonArray(experience),
    education: parseJsonArray(education),
    skills: parseJsonArray(skills),
    projects: parseJsonArray(projects),
    resumePath: resumeKey,
    resumeOriginalName: req.file.originalname,
    stageHistory: [{ stage: "applied", by: "system" }],
    consent: {
      aiProcessing: consentAi,
      dataProcessing: consentData,
      at: consentAi || consentData ? new Date() : undefined,
      ipAddress: req.ip,
    },
  });

  const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });

  await notifyAdmin({
    companyId: job.company,
    type: "new_candidate_applied",
    title: "New candidate applied",
    message: `${candidate.basicDetails.name} applied for ${job.title}.`,
    meta: { candidateId: candidate._id, jobId: job._id },
  });

  await notifyCandidate({
    candidateId: candidate._id,
    userId: applicantUser?._id,
    type: "application_submitted",
    title: "Application submitted",
    message: `Your application for ${job.title} has been received.`,
    meta: { jobId: job._id },
    email: { to: candidate.basicDetails.email, template: "applicationSubmittedEmailTemplate", args: [candidate, job] },
  });

  await runAtsForCandidate(candidate, job);

  res.status(201).json(candidate);
}

async function listCandidatesForJob(req, res) {
  const candidates = await Candidate.find({ job: req.params.id, company: req.user.company }).sort({ createdAt: -1 });
  res.json(candidates);
}

async function getCandidate(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company }).populate("job", "title");
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  res.json(candidate);
}

// Move a candidate to another pipeline stage. Accepts either `stage` (new) or
// `status` (legacy body key) plus an optional `note` and `offerMessage`. All
// validation, history, notifications, and realtime updates run in the pipeline
// service; invalid transitions throw and surface as 400.
async function moveStage(req, res) {
  const toStage = req.body.stage || req.body.status;
  if (!toStage) return res.status(400).json({ error: "A target stage is required" });

  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company }).populate("job", "title");
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  await applyTransition(candidate, toStage, {
    note: req.body.note,
    offerMessage: req.body.offerMessage,
    actorName: req.user.name || req.user.email || "admin",
  });

  res.json(candidate);
}

async function getTimeline(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company })
    .select("status stageHistory offer basicDetails job createdAt")
    .populate("job", "title");
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  res.json({
    status: candidate.status,
    stageLabel: stageLabel(candidate.status),
    stageHistory: candidate.stageHistory,
    offer: candidate.offer,
    allowedNextStages: allowedNextStages(candidate.status).map((s) => ({ stage: s, label: stageLabel(s) })),
  });
}

// Export the full candidate record (profile, ATS, timeline) as a downloadable
// JSON file. PDF report generation is a later phase; this covers "Export
// Candidate Data" today.
async function exportCandidate(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company }).populate("job", "title");
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const payload = {
    exportedAt: new Date().toISOString(),
    candidate: {
      name: candidate.basicDetails.name,
      email: candidate.basicDetails.email,
      phone: candidate.basicDetails.phone,
      location: candidate.basicDetails.location,
      job: candidate.job?.title,
      currentStage: stageLabel(candidate.status),
      appliedAt: candidate.createdAt,
    },
    ats: candidate.ats,
    offer: candidate.offer,
    timeline: candidate.stageHistory.map((h) => ({ stage: stageLabel(h.stage), by: h.by, note: h.note, at: h.at })),
    skills: candidate.skills,
    experience: candidate.experience,
    education: candidate.education,
    projects: candidate.projects,
    certificates: candidate.certificates,
  };

  const safeName = String(candidate.basicDetails.name || "candidate").replace(/[^a-z0-9]+/gi, "_");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_report.json"`);
  res.send(JSON.stringify(payload, null, 2));
}

async function downloadResume(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  if (!candidate.resumePath) return res.status(404).json({ error: "No resume on file" });
  await storageService.sendDownload(res, candidate.resumePath, candidate.resumeOriginalName || "resume");
}

async function getAtsResult(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company }).select(
    "ats status basicDetails job"
  );
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  res.json(candidate.ats);
}

async function rerunAts(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  const job = await Job.findById(candidate.job);
  if (!job) return res.status(404).json({ error: "Job not found for this candidate" });

  await runAtsForCandidate(candidate, job);
  res.json(candidate);
}

// Curated AI-interview report for the admin review screen. Returns only what the
// recruiter needs (transcript + evaluation + provenance + stage actions) — never the
// session's magic-link tokenHash or other internals. Tenant-scoped by company.
// Assembles the AI interview report for a candidate (scoped to the company). Returns null when
// the candidate isn't found so callers can 404. Shared by the JSON endpoint (admin review screen)
// and the PDF export so both render identical data.
async function buildInterviewReport(candidateId, companyId) {
  const candidate = await Candidate.findOne({ _id: candidateId, company: companyId })
    .select("basicDetails status job stageHistory")
    .populate("job", "title department");
  if (!candidate) return null;

  const history = candidate.stageHistory || [];
  const lastDecision = history.length ? history[history.length - 1] : null;

  const base = {
    candidate: {
      id: candidate._id,
      name: candidate.basicDetails?.name,
      email: candidate.basicDetails?.email,
    },
    job: candidate.job ? { title: candidate.job.title, department: candidate.job.department } : null,
    stage: candidate.status,
    stageLabel: stageLabel(candidate.status),
    allowedNextStages: allowedNextStages(candidate.status).map((s) => ({ stage: s, label: stageLabel(s) })),
    // §7: who set the current outcome and when — reuses the existing append-only
    // stageHistory (pipelineService.applyTransition already records the actor: a real
    // admin's name/email for a manual move, "AI Interviewer" / "system" for automated ones).
    decisionTrail: lastDecision
      ? { stage: lastDecision.stage, stageLabel: stageLabel(lastDecision.stage), by: lastDecision.by, at: lastDecision.at, note: lastDecision.note }
      : null,
  };

  const session = await InterviewSession.findOne({ candidate: candidate._id, company: companyId });
  const ai = session && session.aiInterview;
  if (!ai || ai.status === "not_started") {
    return { ...base, hasInterview: false };
  }

  const substance = computeAnswerSubstance(ai.turns);
  const durationFlag = computeDurationFlag({ startedAt: ai.startedAt, completedAt: ai.completedAt, questionCount: ai.questionCount });
  const engineRan = ai.evaluation?.generatedBy === "ai";
  const verdict = computeVerdict({
    responsiveCount: substance.responsiveCount,
    totalAnswers: substance.totalAnswers,
    engineRan,
    overallScore: ai.evaluation?.overallScore,
  });

  return {
    ...base,
    hasInterview: true,
    interview: {
      status: ai.status,
      engine: ai.engine,
      modality: ai.modality || "text",
      questionCount: ai.questionCount,
      maxQuestions: ai.maxQuestions,
      startedAt: ai.startedAt,
      completedAt: ai.completedAt,
      plan: ai.plan,
      transcript: buildTranscript(ai.turns, substance.answers),
      evaluation: ai.evaluation || null,
      competencyTriplet: competencyTripletOrNull(ai.evaluation),
      competencyTable: buildCompetencyTable(ai.turns),
      substance: { responsiveCount: substance.responsiveCount, totalAnswers: substance.totalAnswers },
      durationFlag,
      verdict,
      recommendedAction: recommendedAction(verdict, durationFlag),
    },
    proctoring: buildProctoringSummary(session.proctoring),
  };
}

// §2: merges each candidate turn with its precomputed substance stats (word count /
// duration / responsive tag). `answers` is indexed over candidate turns only (see
// interviewReportEngine.computeAnswerSubstance), so a running counter maps one to the other.
function buildTranscript(turns, answers) {
  let answerIndex = 0;
  return (turns || []).map((t) => {
    const row = {
      role: t.role,
      kind: t.kind,
      text: t.text,
      topic: t.topic,
      difficulty: t.difficulty,
      answerScore: t.answerScore,
      inputMode: t.inputMode,
      deliveryScore: t.acoustic?.deliveryScore,
      at: t.at,
    };
    if (t.role === "candidate") {
      const a = answers[answerIndex++];
      if (a) Object.assign(row, { wordCount: a.wordCount, durationSec: a.durationSec, responsive: a.responsive });
    }
    return row;
  });
}

// Recruiter-facing integrity summary for the report. Returns null when nothing was recorded (older
// interviews, or the candidate declined proctoring) so the UI can hide the section entirely.
function buildProctoringSummary(p) {
  if (!p) return null;
  const hasSignal = (p.totalEvents || 0) > 0 || p.consent?.given || p.consent?.declined || p.identityMatch?.status !== "unknown";
  if (!hasSignal) return null;

  // Recomputed fresh from the raw per-type counts (not the persisted riskScore/riskBand,
  // which may have been written under an older, less-dampened formula) so the severity
  // fix in utils/proctoring.js applies to already-completed sessions too.
  const { riskScore, riskBand } = proctoring.computeRisk(p.counts);
  const identityUnknown = (p.identityMatch?.status || "unknown") === "unknown";
  // §8: gate the headline risk behind identity verification — if we don't know who was
  // sitting there, don't let a "High" risk badge read as proof of misconduct.
  const displayRiskScore = identityUnknown ? Math.min(riskScore, 49) : riskScore;
  const displayRiskBand = identityUnknown ? proctoring.bandFor(displayRiskScore) : riskBand;

  return {
    consent: p.consent || null,
    visionEnabled: !!p.visionEnabled,
    riskScore,
    riskBand,
    displayRiskScore,
    displayRiskBand,
    identityGated: identityUnknown,
    identityGateNote: identityUnknown ? "Identity unverified — integrity signals unreliable." : null,
    totalEvents: p.totalEvents || 0,
    identityMatch: p.identityMatch || null,
    breakdown: proctoring.breakdown(p.counts),
    recentEvents: (p.events || [])
      .slice(-25)
      .reverse()
      .map((e) => ({ type: e.type, label: proctoring.labelOf(e.type), severity: e.severity, meta: e.meta, at: e.at })),
  };
}

async function getInterviewReport(req, res) {
  const report = await buildInterviewReport(req.params.id, req.user.company);
  if (!report) return res.status(404).json({ error: "Candidate not found" });
  res.json(report);
}

// Streams the same report as a downloadable PDF.
async function getInterviewReportPdf(req, res) {
  const report = await buildInterviewReport(req.params.id, req.user.company);
  if (!report) return res.status(404).json({ error: "Candidate not found" });

  const { buildReportPdf } = require("../services/interviewReportPdf");
  const pdf = buildReportPdf(report);

  const safeName = String(report.candidate?.name || "candidate").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "candidate";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="interview-report-${safeName}.pdf"`);
  res.setHeader("Content-Length", pdf.length);
  res.send(pdf);
}

module.exports = {
  applyToJob,
  listCandidatesForJob,
  getCandidate,
  moveStage,
  getTimeline,
  exportCandidate,
  downloadResume,
  getAtsResult,
  rerunAts,
  getInterviewReport,
  getInterviewReportPdf,
};
