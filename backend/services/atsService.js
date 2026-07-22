const path = require("path");
const InterviewQueue = require("../models/InterviewQueue");
const User = require("../models/User");
const CompanySettings = require("../models/CompanySettings");
const storageService = require("./storageService");
const extractResumeText = require("../utils/extractResumeText");
const { detectFileType } = require("../utils/verifyFileSignature");
const { computeAtsScore } = require("../utils/atsEngine");
const { createInterviewSessionIfNeeded } = require("./interviewInvitationService");
const { notifyAdmin, notifyCandidate } = require("./notificationService");
const { appendStageHistory } = require("../utils/pipeline");

async function getResumeText(candidate) {
  let buffer;
  try {
    buffer = await storageService.getObjectBuffer(candidate.resumePath);
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

  let reviewNeeded = false;

  if (result.decision === "pass") {
    // ATS pass advances the candidate through "ATS Passed" and, since an
    // interview session is minted immediately below, on to "Interview
    // Scheduled". History is recorded silently here — ATS sends its own
    // notifications, so we don't route through pipelineService (which would
    // double-notify). Guarded on "applied" so an ATS rerun on an already
    // advanced candidate doesn't re-stamp the timeline.
    if (candidate.status === "applied") {
      appendStageHistory(candidate, "ats_passed");
      candidate.status = "interview_scheduled";
      appendStageHistory(candidate, "interview_scheduled");
    }
    await InterviewQueue.findOneAndUpdate(
      { candidate: candidate._id },
      { candidate: candidate._id, job: job._id, company: job.company, atsScore: result.overallScore, status: "queued" },
      { upsert: true, new: true }
    );
    await createInterviewSessionIfNeeded(candidate, job);
  } else {
    // Automated rejection is a fair-hiring / legal-exposure decision. Only auto-reject
    // (and email the candidate) when the tenant has explicitly opted in; otherwise keep
    // a human in the loop — leave the candidate in place and flag it for admin review.
    const settings = await CompanySettings.findOne({ company: job.company }).select("compliance");
    const autoReject = settings?.compliance?.autoRejectAllowed === true;

    if (autoReject) {
      if (candidate.status !== "rejected") {
        appendStageHistory(candidate, "rejected", { note: `ATS score ${result.overallScore} below threshold (auto-reject)` });
      }
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
    } else {
      // Human-in-the-loop: no status change, no candidate email — the admin decides.
      reviewNeeded = true;
    }
  }

  await notifyAdmin({
    companyId: job.company,
    type: "ats_completed",
    title: reviewNeeded ? "ATS below threshold — needs review" : "ATS screening completed",
    message: reviewNeeded
      ? `${candidate.basicDetails.name}'s ATS score for ${job.title} was ${result.overallScore} (below threshold). Auto-reject is off — please review and decide.`
      : `${candidate.basicDetails.name}'s ATS screening for ${job.title} completed with a score of ${result.overallScore} (${result.decision}).`,
    meta: { candidateId: candidate._id, jobId: job._id, score: result.overallScore, decision: result.decision, reviewNeeded },
  });

  await candidate.save();
  return candidate;
}

module.exports = { runAtsForCandidate };
