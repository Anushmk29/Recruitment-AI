const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const User = require("../models/User");
const { runAtsForCandidate } = require("../services/atsService");
const { notifyAdmin, notifyCandidate } = require("../services/notificationService");

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function applyToJob(req, res) {
  const { id: jobIdOrSlug } = req.params;
  const { name, email, phone, location, linkedinUrl, portfolioUrl, experience, education, skills, projects, certificates } =
    req.body;

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

  const candidate = await Candidate.create({
    job: job._id,
    company: job.company,
    basicDetails: { name, email, phone, location, linkedinUrl, portfolioUrl },
    experience: parseJsonArray(experience),
    education: parseJsonArray(education),
    skills: parseJsonArray(skills),
    projects: parseJsonArray(projects),
    certificates: parseJsonArray(certificates),
    resumePath: req.file.path,
    resumeOriginalName: req.file.originalname,
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

const STATUS_NOTIFICATIONS = {
  shortlisted: {
    admin: { type: "candidate_shortlisted", title: "Candidate shortlisted" },
    candidate: { type: "next_round_scheduled", title: "You've been shortlisted" },
  },
  next_round: {
    admin: null,
    candidate: { type: "next_round_scheduled", title: "You've advanced to the next round" },
  },
  rejected: {
    admin: { type: "candidate_rejected", title: "Candidate rejected" },
    candidate: { type: "rejection", title: "Application update" },
  },
};

async function updateCandidateStatus(req, res) {
  const { status } = req.body;
  const candidate = await Candidate.findOneAndUpdate(
    { _id: req.params.id, company: req.user.company },
    { status },
    { new: true }
  ).populate("job", "title");
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const config = STATUS_NOTIFICATIONS[status];
  if (config) {
    const jobTitle = candidate.job?.title || "the role";
    if (config.admin) {
      await notifyAdmin({
        companyId: candidate.company,
        type: config.admin.type,
        title: config.admin.title,
        message: `${candidate.basicDetails.name}'s status for ${jobTitle} was updated to ${status}.`,
        meta: { candidateId: candidate._id },
      });
    }
    if (config.candidate) {
      const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });
      await notifyCandidate({
        candidateId: candidate._id,
        userId: applicantUser?._id,
        type: config.candidate.type,
        title: config.candidate.title,
        message: `Your application for ${jobTitle} has been updated to: ${status}.`,
        meta: { jobId: candidate.job?._id },
      });
    }
  }

  res.json(candidate);
}

async function downloadResume(req, res) {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.user.company });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  res.download(candidate.resumePath, candidate.resumeOriginalName || "resume");
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

module.exports = {
  applyToJob,
  listCandidatesForJob,
  getCandidate,
  updateCandidateStatus,
  downloadResume,
  getAtsResult,
  rerunAts,
};
