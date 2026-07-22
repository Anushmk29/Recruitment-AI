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
  // Strip any trailing slash(es) so a CLIENT_ORIGIN_USER written as "https://host/"
  // doesn't produce "https://host//interview/..." — the double slash breaks the SPA's
  // client-side route match and renders a blank page.
  const base = (process.env.CLIENT_ORIGIN_USER || "http://localhost:5174").replace(/\/+$/, "");
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

// A session can no longer be resent/rescheduled once the candidate has actually
// started or finished the interview — rotating the token then would be pointless
// (or would strand an in-progress attempt).
const REGENERATE_BLOCKED_STATUSES = ["in_progress", "completed"];

// Resend an interview link, or reschedule it to a new time. Because we only ever
// store the token *hash* (never the raw token), the original link can't be
// reconstructed — so both operations mint a *fresh* token. That is also the safer
// default: any previously-shared/expired link stops working. Pass `interviewAt` to
// reschedule; omit it to resend the same slot with a refreshed validity window.
// Unlike createInterviewSessionIfNeeded (which is idempotent on auto-apply), this is
// an explicit recruiter action and always rotates the token and re-emails.
async function resendOrRescheduleInterview(session, candidate, job, { interviewAt } = {}) {
  if (REGENERATE_BLOCKED_STATUSES.includes(session.status) || REGENERATE_BLOCKED_STATUSES.includes(session.aiInterview?.status)) {
    throw new Error("This interview has already started or been completed and can no longer be resent or rescheduled");
  }

  const nextInterviewAt = interviewAt ? new Date(interviewAt) : session.interviewAt;
  if (Number.isNaN(nextInterviewAt.getTime())) {
    throw new Error("Invalid interview date/time");
  }

  const token = crypto.randomBytes(32).toString("hex");
  session.tokenHash = hashToken(token);
  session.interviewAt = nextInterviewAt;
  session.expiresAt = computeExpiresAt(nextInterviewAt);
  session.status = "scheduled";
  session.accessedAt = undefined; // fresh link — clear the "already opened" marker
  // Let the reminder cron fire again for the (possibly new) slot.
  session.reminder24hSent = false;
  session.reminder1hSent = false;
  await session.save();

  const interviewUrl = buildInterviewUrl(token);
  const sessionWithUrl = { ...session.toObject(), interviewUrl };
  const rescheduled = Boolean(interviewAt);

  const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });
  await notifyCandidate({
    candidateId: candidate._id,
    userId: applicantUser?._id,
    type: "interview_invite",
    title: rescheduled ? `Interview rescheduled for ${job.title}` : `Your interview link for ${job.title}`,
    message: rescheduled
      ? `Your interview has been rescheduled to ${nextInterviewAt.toLocaleString("en-US")}. Check your email for the updated interview link.`
      : `Here is your interview link for ${job.title}. Your interview is scheduled for ${nextInterviewAt.toLocaleString("en-US")}. Check your email for the link and instructions.`,
    meta: { interviewSessionId: session._id, jobId: job._id },
    email: {
      to: candidate.basicDetails.email,
      template: "interviewInvitationEmailTemplate",
      args: [candidate, job, sessionWithUrl],
    },
  });

  // interviewUrl is returned so the caller (recruiter) can copy/share the link directly —
  // it can't be reconstructed later since only the token hash is persisted.
  return { session, interviewUrl };
}

module.exports = { createInterviewSessionIfNeeded, resendOrRescheduleInterview, hashToken, buildInterviewUrl };
