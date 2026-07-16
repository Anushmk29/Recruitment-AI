const crypto = require("crypto");
const InterviewSession = require("../models/InterviewSession");
const User = require("../models/User");
const { notifyCandidate } = require("./notificationService");

const SCHEDULE_DELAY_DAYS = Number(process.env.INTERVIEW_SCHEDULE_DELAY_DAYS) || 3;
const SCHEDULE_HOUR_UTC = Number(process.env.INTERVIEW_SCHEDULE_HOUR_UTC) || 11;
const LINK_VALIDITY_HOURS_AFTER_INTERVIEW = Number(process.env.INTERVIEW_LINK_VALIDITY_HOURS) || 48;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function computeInterviewAt() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + SCHEDULE_DELAY_DAYS);
  date.setUTCHours(SCHEDULE_HOUR_UTC, 0, 0, 0);
  return date;
}

function computeExpiresAt(interviewAt) {
  const expires = new Date(interviewAt);
  expires.setUTCHours(expires.getUTCHours() + LINK_VALIDITY_HOURS_AFTER_INTERVIEW);
  return expires;
}

function buildInterviewUrl(token) {
  const base = process.env.CLIENT_ORIGIN_USER || "http://localhost:5174";
  return `${base}/interview/${token}`;
}

// Idempotent: if a session already exists for this candidate (e.g. ATS was
// re-run after already passing once), we don't mint a new token or resend
// the email — that would invalidate a link the candidate may already have.
async function createInterviewSessionIfNeeded(candidate, job) {
  const existing = await InterviewSession.findOne({ candidate: candidate._id });
  if (existing) return existing;

  const token = crypto.randomBytes(32).toString("hex");
  const interviewAt = computeInterviewAt();
  const expiresAt = computeExpiresAt(interviewAt);

  const session = await InterviewSession.create({
    candidate: candidate._id,
    job: job._id,
    company: job.company,
    tokenHash: hashToken(token),
    interviewAt,
    expiresAt,
    instructions: job.interviewInstructions,
  });

  const interviewUrl = buildInterviewUrl(token);
  const sessionWithUrl = { ...session.toObject(), interviewUrl };

  const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });
  await notifyCandidate({
    candidateId: candidate._id,
    userId: applicantUser?._id,
    type: "interview_invite",
    title: `Interview scheduled for ${job.title}`,
    message: `Your interview is scheduled for ${interviewAt.toLocaleString("en-US")}. Check your email for the interview link and instructions.`,
    meta: { interviewSessionId: session._id, jobId: job._id },
    email: {
      to: candidate.basicDetails.email,
      template: "interviewInvitationEmailTemplate",
      args: [candidate, job, sessionWithUrl],
    },
  });

  return session;
}

module.exports = { createInterviewSessionIfNeeded, hashToken, buildInterviewUrl };
