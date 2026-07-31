// Admin assessment-session endpoints: the recruiter gate (Send / Skip), the
// per-job status tracker with its awaiting-decision queue (A2.7), and the
// soft-lock human actions (A4.2 — resume/end always carry a typed reason).

const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const AssessmentSession = require("../models/AssessmentSession");
const AssessmentPaper = require("../models/AssessmentPaper");
const AuditLog = require("../models/AuditLog");
const assessmentService = require("../services/assessmentService");
const paperService = require("../services/assessmentPaperService");

async function loadCandidate(req) {
  const candidate = await Candidate.findOne({ _id: req.params.candidateId, company: req.user.company }).populate("job");
  if (!candidate) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  return candidate;
}

// --- The recruiter gate (A2.3) ----------------------------------------------

async function sendToCandidate(req, res) {
  const candidate = await loadCandidate(req);
  const job = candidate.job;
  if (!job) return res.status(409).json({ error: "Candidate has no job attached" });
  if (job.assessmentPolicy === "off") {
    return res.status(409).json({
      error: 'Assessments are off for this job — set the job\'s assessment policy to "manual" first',
      code: "ASSESSMENT_POLICY_OFF",
    });
  }
  const { session, created, assessmentUrl } = await assessmentService.sendAssessment(candidate, job, {
    user: req.user,
    mode: "manual",
    difficultyOverride: req.body?.difficultyOverride || undefined,
  });
  res.status(created ? 201 : 200).json({ session, created, assessmentUrl });
}

async function skipForCandidate(req, res) {
  const candidate = await loadCandidate(req);
  if (!candidate.job) return res.status(409).json({ error: "Candidate has no job attached" });
  const updated = await assessmentService.skipAssessment(candidate, { user: req.user });
  res.json({ candidate: updated, skipped: true });
}

// --- Per-candidate detail (admin report view) --------------------------------

async function getForCandidate(req, res) {
  const candidate = await loadCandidate(req);
  const session = await AssessmentSession.findOne({ candidate: candidate._id, company: req.user.company }).sort({ createdAt: -1 });
  if (!session) {
    return res.json({
      session: null,
      decision: candidate.assessmentDecision?.action ? candidate.assessmentDecision : null,
    });
  }
  const paper = await AssessmentPaper.findById(session.paper).select("sections version difficultyPolicy items.id items.criterionId items.stem items.status");
  res.json({
    session,
    decision: candidate.assessmentDecision?.action ? candidate.assessmentDecision : null,
    paper: paper
      ? {
          version: paper.version,
          difficultyPolicy: paper.difficultyPolicy,
          sections: paper.sections.map((s) => ({ id: s.id, title: s.title, timeLimitSec: s.timeLimitSec })),
          // Stems only — enough for the admin to read a result row in context.
          items: paper.items.map((i) => ({ id: i.id, criterionId: i.criterionId, stem: i.stem, status: i.status })),
        }
      : null,
  });
}

// --- A2.7 tracker + awaiting-decision queue ----------------------------------

async function jobOverview(req, res) {
  const job = await Job.findOne({ _id: req.params.jobId, company: req.user.company });
  if (!job) return res.status(404).json({ error: "Job not found" });

  const [paperStatus, sessions, awaiting] = await Promise.all([
    paperService.latestStatusForJob(job._id, req.user.company),
    AssessmentSession.find({ job: job._id, company: req.user.company })
      .sort({ createdAt: -1 })
      .populate("candidate", "basicDetails.name basicDetails.email status assessmentDecision"),
    // The gate is a queue, not a hunt: ATS-passed, no decision recorded yet.
    job.assessmentPolicy === "manual"
      ? Candidate.find({
          job: job._id,
          company: req.user.company,
          status: "ats_passed",
          "assessmentDecision.action": { $exists: false },
        }).select("basicDetails.name basicDetails.email ats.overallScore createdAt")
      : [],
  ]);

  const counts = { scheduled: 0, in_progress: 0, paused: 0, completed: 0, expired: 0, cancelled: 0 };
  for (const s of sessions) counts[s.status] = (counts[s.status] || 0) + 1;

  res.json({
    job: { id: job._id, title: job.title, assessmentPolicy: job.assessmentPolicy },
    paperStatus,
    engineEnabled: paperService.engineEnabled(),
    counts,
    awaitingDecision: awaiting,
    sessions: sessions.map((s) => ({
      id: s._id,
      candidate: s.candidate
        ? { id: s.candidate._id, name: s.candidate.basicDetails?.name, email: s.candidate.basicDetails?.email, stage: s.candidate.status }
        : null,
      status: s.status,
      assignment: s.assignment,
      difficultyTier: s.difficultyTier,
      startDeadline: s.startDeadline,
      expiresAt: s.expiresAt,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      sectionState: s.sectionState,
      result: s.result?.scoredAt
        ? {
            totalItems: s.result.totalItems,
            totalCorrect: s.result.totalCorrect,
            perCriterion: s.result.perCriterion,
            claimVerdicts: s.result.claimVerdicts,
            completedBy: s.result.completedBy,
            reproducibilityHash: s.result.reproducibilityHash,
          }
        : null,
      proctoring: { riskScore: s.proctoring?.riskScore || 0, riskBand: s.proctoring?.riskBand || "low", totalEvents: s.proctoring?.totalEvents || 0 },
    })),
  });
}

// --- Session actions ---------------------------------------------------------

async function loadSession(req) {
  const session = await AssessmentSession.findOne({ _id: req.params.id, company: req.user.company })
    .populate("candidate")
    .populate("job");
  if (!session) {
    const err = new Error("Assessment session not found");
    err.status = 404;
    throw err;
  }
  return session;
}

async function resend(req, res) {
  const session = await loadSession(req);
  const { assessmentUrl } = await assessmentService.resendAssessment(session, session.candidate, session.job);
  res.json({ session, assessmentUrl });
}

async function cancel(req, res) {
  const session = await loadSession(req);
  if (session.status === "completed") return res.status(409).json({ error: "A completed assessment cannot be cancelled" });
  session.status = "cancelled";
  await session.save();
  res.json({ session });
}

// A4.2 — the two human soft-lock actions. Both REQUIRE a typed reason and write
// an explicit AuditLog row (the pause was an automated act; the resolution must
// be an accountable human one).
async function resumeSession(req, res) {
  const session = await loadSession(req);
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required to resume a paused assessment" });
  if (session.status !== "paused") return res.status(409).json({ error: "This assessment is not paused" });
  await assessmentService.resumeFromPause(session, { by: req.user.name || req.user.email });
  await AuditLog.create({
    company: req.user.company,
    actorUserId: req.user._id,
    actorEmail: req.user.email,
    action: "assessment.softlock.resume",
    resourceType: "assessmentSession",
    resourceId: String(session._id),
    meta: { reason },
  }).catch(() => {});
  res.json({ session });
}

async function endSession(req, res) {
  const session = await loadSession(req);
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required to end an assessment" });
  if (!["in_progress", "paused"].includes(session.status)) {
    return res.status(409).json({ error: "Only an in-progress or paused assessment can be ended" });
  }
  // Ending scores what exists and labels it — work is never discarded.
  const finalized = await assessmentService.finalizeSession(session, { completedBy: "expiry" });
  await AuditLog.create({
    company: req.user.company,
    actorUserId: req.user._id,
    actorEmail: req.user.email,
    action: "assessment.softlock.end",
    resourceType: "assessmentSession",
    resourceId: String(session._id),
    meta: { reason },
  }).catch(() => {});
  res.json({ session: finalized });
}

module.exports = {
  sendToCandidate,
  skipForCandidate,
  getForCandidate,
  jobOverview,
  resend,
  cancel,
  resumeSession,
  endSession,
};
