const InterviewSession = require("../models/InterviewSession");
const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const ProctoringEvidence = require("../models/ProctoringEvidence");
const storageService = require("../services/storageService");
const { writeAuditLog } = require("../middleware/auditLog");
const { hashToken, resendOrRescheduleInterview } = require("../services/interviewInvitationService");

async function verifyToken(req, res) {
  const { token } = req.params;
  const tokenHash = hashToken(token);

  const session = await InterviewSession.findOne({ tokenHash }).populate("candidate", "basicDetails").populate("job", "title department");
  if (!session) return res.status(404).json({ error: "Invalid interview link" });

  if (session.status === "cancelled") {
    return res.status(410).json({ error: "This interview has been cancelled" });
  }
  if (new Date() > session.expiresAt) {
    if (session.status !== "expired") {
      session.status = "expired";
      await session.save();
    }
    return res.status(410).json({ error: "This interview link has expired" });
  }

  if (!session.accessedAt) {
    session.accessedAt = new Date();
    await session.save();
  }

  res.json({
    candidateName: session.candidate.basicDetails.name,
    jobTitle: session.job.title,
    department: session.job.department,
    interviewAt: session.interviewAt,
    expiresAt: session.expiresAt,
    instructions: session.instructions,
    status: session.status,
  });
}

async function getForCandidate(req, res) {
  const session = await InterviewSession.findOne({ candidate: req.params.id, company: req.user.company }).populate(
    "job",
    "title department"
  );
  if (!session) return res.status(404).json({ error: "No interview session found for this candidate" });
  res.json(session);
}

// Load the session + its candidate + job for an admin action, all scoped to the
// caller's company (tenantScope also enforces this as a safety net). Returns null
// if the candidate has no interview session yet.
async function loadAdminSessionContext(candidateId, companyId) {
  const session = await InterviewSession.findOne({ candidate: candidateId, company: companyId });
  if (!session) return null;
  const candidate = await Candidate.findOne({ _id: candidateId, company: companyId });
  const job = candidate ? await Job.findById(candidate.job) : null;
  return { session, candidate, job };
}

// POST /interview-sessions/candidate/:id/resend
// Re-send the interview invitation (rotates the magic-link token, refreshes the
// validity window, keeps the same scheduled time).
async function resendInterview(req, res) {
  const ctx = await loadAdminSessionContext(req.params.id, req.user.company);
  if (!ctx) return res.status(404).json({ error: "No interview session found for this candidate" });
  if (!ctx.candidate || !ctx.job) return res.status(404).json({ error: "Candidate or job not found for this session" });

  const { session, interviewUrl } = await resendOrRescheduleInterview(ctx.session, ctx.candidate, ctx.job, {});
  res.json({ ok: true, interviewUrl, interviewAt: session.interviewAt, expiresAt: session.expiresAt, status: session.status });
}

// POST /interview-sessions/candidate/:id/reschedule  body: { interviewAt }
// Move the interview to a new time and re-send the invitation with a fresh link.
async function rescheduleInterview(req, res) {
  const { interviewAt } = req.body;
  if (!interviewAt) return res.status(400).json({ error: "interviewAt is required" });
  const when = new Date(interviewAt);
  if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "interviewAt is not a valid date" });
  if (when.getTime() <= Date.now()) return res.status(400).json({ error: "interviewAt must be in the future" });

  const ctx = await loadAdminSessionContext(req.params.id, req.user.company);
  if (!ctx) return res.status(404).json({ error: "No interview session found for this candidate" });
  if (!ctx.candidate || !ctx.job) return res.status(404).json({ error: "Candidate or job not found for this session" });

  const { session, interviewUrl } = await resendOrRescheduleInterview(ctx.session, ctx.candidate, ctx.job, { interviewAt: when });
  res.json({ ok: true, interviewUrl, interviewAt: session.interviewAt, expiresAt: session.expiresAt, status: session.status });
}

// ---------------------------------------------------------------------------
// Phase 14.5 — evidence-clip review (human eyes only)
// ---------------------------------------------------------------------------

// GET /interview-sessions/candidate/:id/evidence — clip metadata for the
// candidate's session, next to the flags they evidence. Never the bytes.
async function listEvidence(req, res) {
  const rows = await ProctoringEvidence.find({ company: req.user.company, candidate: req.params.id })
    .sort({ capturedAt: 1 })
    .select("-clipKey -__v")
    .lean();
  res.json({ items: rows });
}

// GET /interview-sessions/evidence/:evidenceId — stream one clip to the
// reviewer. Access to biometric-adjacent footage must itself be auditable:
// EVERY view writes an AuditLog row before a single byte is sent.
async function streamEvidenceClip(req, res) {
  const row = await ProctoringEvidence.findOne({ _id: req.params.evidenceId, company: req.user.company });
  if (!row) return res.status(404).json({ error: "Evidence clip not found" });

  writeAuditLog({
    req,
    company: req.user.company,
    action: "evidence.view",
    resourceType: "ProctoringEvidence",
    resourceId: String(row._id),
    meta: { eventType: row.eventType, source: row.source, session: String(row.session) },
  });

  const buffer = await storageService.getObjectBuffer(row.clipKey);
  res.setHeader("Content-Type", row.mimeType || "video/webm");
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

module.exports = { verifyToken, getForCandidate, resendInterview, rescheduleInterview, listEvidence, streamEvidenceClip };
