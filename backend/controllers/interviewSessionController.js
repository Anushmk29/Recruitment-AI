const InterviewSession = require("../models/InterviewSession");
const { hashToken } = require("../services/interviewInvitationService");

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

module.exports = { verifyToken, getForCandidate };
