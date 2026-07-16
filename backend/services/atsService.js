const fs = require("fs/promises");
const path = require("path");
const InterviewQueue = require("../models/InterviewQueue");
const User = require("../models/User");
const extractResumeText = require("../utils/extractResumeText");
const { detectFileType } = require("../utils/verifyFileSignature");
const { computeAtsScore } = require("../utils/atsEngine");
const { createInterviewSessionIfNeeded } = require("./interviewInvitationService");
const { notifyAdmin, notifyCandidate } = require("./notificationService");

async function getResumeText(candidate) {
  let buffer;
  try {
    buffer = await fs.readFile(candidate.resumePath);
  } catch (err) {
    console.error("Could not read resume file for ATS scoring:", err.message);
    return "";
  }

  let mimeType = detectFileType(buffer);
  if (!mimeType) {
    // Legacy .doc uploads (pre-dating magic-byte detection) aren't a supported
    // extraction format; fall back to extension so scoring still runs on
    // structured fields even though resume text will be empty.
    const ext = path.extname(candidate.resumePath).toLowerCase();
    if (ext !== ".doc") return "";
    return "";
  }

  const { text } = await extractResumeText(buffer, mimeType);
  return text;
}

async function runAtsForCandidate(candidate, job) {
  const resumeText = await getResumeText(candidate);
  candidate.resumeText = resumeText;

  const result = computeAtsScore(job, candidate, resumeText);
  candidate.ats = result;

  if (result.decision === "pass") {
    candidate.status = "interview_queue";
    await InterviewQueue.findOneAndUpdate(
      { candidate: candidate._id },
      { candidate: candidate._id, job: job._id, company: job.company, atsScore: result.overallScore, status: "queued" },
      { upsert: true, new: true }
    );
    await createInterviewSessionIfNeeded(candidate, job);
  } else {
    candidate.status = "rejected";
    const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });
    await notifyCandidate({
      candidateId: candidate._id,
      userId: applicantUser?._id,
      type: "rejection",
      title: "Application update",
      message: `Thank you for applying for ${job.title}. We will not be moving forward at this time.`,
      meta: { jobId: job._id },
      email: { to: candidate.basicDetails.email, template: "rejectionEmailTemplate", args: [candidate, job] },
    });
  }

  await notifyAdmin({
    companyId: job.company,
    type: "ats_completed",
    title: "ATS screening completed",
    message: `${candidate.basicDetails.name}'s ATS screening for ${job.title} completed with a score of ${result.overallScore} (${result.decision}).`,
    meta: { candidateId: candidate._id, jobId: job._id, score: result.overallScore, decision: result.decision },
  });

  await candidate.save();
  return candidate;
}

module.exports = { runAtsForCandidate };
