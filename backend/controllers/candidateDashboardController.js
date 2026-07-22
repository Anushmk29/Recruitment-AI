const User = require("../models/User");
const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const Resume = require("../models/Resume");
const InterviewSession = require("../models/InterviewSession");
const Notification = require("../models/Notification");
const CandidateProfile = require("../models/CandidateProfile");
const CandidateDashboard = require("../models/CandidateDashboard");
const { notifyCandidate } = require("../services/notificationService");

async function getOrCreateProfile(userId) {
  let profile = await CandidateProfile.findOne({ user: userId });
  if (!profile) {
    profile = await CandidateProfile.create({ user: userId });
  }
  return profile;
}

async function computeProfileCompletion(user, profile, hasResume, applicationCount) {
  let score = 0;
  if (hasResume) score += 25;
  if (user.phone) score += 25;
  if (profile.headline && profile.location && profile.bio && profile.skills.length > 0) score += 25;
  if (applicationCount > 0) score += 25;
  return score;
}

async function getDashboard(req, res) {
  const user = req.user;
  const profile = await getOrCreateProfile(user._id);

  const applications = await Candidate.find({ "basicDetails.email": user.email })
    .populate({ path: "job", select: "title department company", populate: { path: "company", select: "name" } })
    .sort({ createdAt: -1 });
  const applicationIds = applications.map((a) => a._id);

  const resumes = await Resume.find({ candidateEmail: user.email }).sort({ createdAt: -1 }).limit(5);
  const hasResume = resumes.length > 0;

  const completion = await computeProfileCompletion(user, profile, hasResume, applications.length);
  if (completion !== profile.profileCompletionPercent) {
    profile.profileCompletionPercent = completion;
    await profile.save();
  }

  const appliedJobIds = applications.map((a) => a.job?._id).filter(Boolean);
  const recommendedJobs = await Job.find({
    status: "published",
    _id: { $nin: [...appliedJobIds, ...profile.savedJobs] },
    ...(profile.skills.length > 0 ? { requiredSkills: { $in: profile.skills } } : {}),
  })
    .populate("company", "name")
    .sort({ createdAt: -1 })
    .limit(5);

  const savedJobs = await Job.find({ _id: { $in: profile.savedJobs } }).populate("company", "name");

  const notifications = await Notification.find({
    $or: [{ candidate: { $in: applicationIds } }, { user: user._id }],
  })
    .sort({ createdAt: -1 })
    .limit(20);

  const now = new Date();
  const interviewSessions = await InterviewSession.find({ candidate: { $in: applicationIds } })
    .populate("job", "title department")
    .sort({ interviewAt: -1 });

  const upcomingInterviews = interviewSessions.filter(
    (s) => (s.status === "scheduled" || s.status === "in_progress") && s.interviewAt >= now
  );
  const aiInterviewHistory = interviewSessions.filter((s) => s.status !== "scheduled" || s.interviewAt < now);

  res.json({
    profile: {
      headline: profile.headline,
      location: profile.location,
      skills: profile.skills,
      bio: profile.bio,
      profileCompletionPercent: profile.profileCompletionPercent,
    },
    resume: {
      hasResume,
      latest: resumes[0] || null,
      history: resumes,
    },
    recommendedJobs,
    savedJobs,
    appliedJobs: applications,
    notifications,
    upcomingInterviews,
    aiInterviewHistory,
  });
}

async function updateProfile(req, res) {
  const { headline, location, skills, bio } = req.body;
  const profile = await getOrCreateProfile(req.user._id);

  if (headline !== undefined) profile.headline = headline;
  if (location !== undefined) profile.location = location;
  if (bio !== undefined) profile.bio = bio;
  if (Array.isArray(skills)) profile.skills = skills;

  await profile.save();

  await notifyCandidate({
    userId: req.user._id,
    type: "profile_updated",
    title: "Profile updated",
    message: "Your candidate profile was updated successfully.",
  });

  res.json(profile);
}

async function toggleSavedJob(req, res) {
  const { jobId } = req.params;
  const job = await Job.findById(jobId);
  // Only published jobs are candidate-visible — don't let a candidate save/probe another
  // tenant's draft/closed posting by id.
  if (!job || job.status !== "published") return res.status(404).json({ error: "Job not found" });

  const profile = await getOrCreateProfile(req.user._id);
  const index = profile.savedJobs.findIndex((id) => String(id) === String(jobId));

  if (index >= 0) {
    profile.savedJobs.splice(index, 1);
  } else {
    profile.savedJobs.push(jobId);
  }

  await profile.save();
  res.json({ saved: index < 0, savedJobs: profile.savedJobs });
}

async function initializeDashboard(userId, userName, userEmail) {
  let dashboard = await CandidateDashboard.findOne({ user: userId });
  if (!dashboard) {
    dashboard = await CandidateDashboard.create({ user: userId });
  }
  await getOrCreateProfile(userId);

  if (!dashboard.welcomeNotificationSent) {
    await notifyCandidate({
      userId,
      type: "welcome",
      title: "Welcome to your dashboard",
      message: `Hi ${userName}, your candidate dashboard is ready. Upload your resume and start applying to jobs.`,
      email: userEmail ? { to: userEmail, template: "welcomeEmailTemplate", args: [{ name: userName }] } : undefined,
    });
    dashboard.welcomeNotificationSent = true;
    await dashboard.save();
  }

  return dashboard;
}

module.exports = { getDashboard, updateProfile, toggleSavedJob, initializeDashboard };
