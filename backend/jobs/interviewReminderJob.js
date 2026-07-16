const cron = require("node-cron");
const InterviewSession = require("../models/InterviewSession");
const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const User = require("../models/User");
const { notifyCandidate } = require("../services/notificationService");

const WINDOWS = [
  { field: "reminder24hSent", hoursBefore: 24, toleranceMinutes: 15 },
  { field: "reminder1hSent", hoursBefore: 1, toleranceMinutes: 15 },
];

async function sendDueReminders() {
  const now = Date.now();

  for (const window of WINDOWS) {
    const targetTime = now + window.hoursBefore * 60 * 60 * 1000;
    const rangeStart = new Date(targetTime - window.toleranceMinutes * 60 * 1000);
    const rangeEnd = new Date(targetTime + window.toleranceMinutes * 60 * 1000);

    const sessions = await InterviewSession.find({
      status: "scheduled",
      interviewAt: { $gte: rangeStart, $lte: rangeEnd },
      [window.field]: false,
    });

    for (const session of sessions) {
      const candidate = await Candidate.findById(session.candidate);
      const job = await Job.findById(session.job);
      if (!candidate || !job) continue;

      const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });

      try {
        await notifyCandidate({
          candidateId: candidate._id,
          userId: applicantUser?._id,
          type: "interview_reminder",
          title: `Interview reminder: ${job.title}`,
          message: `Your interview for ${job.title} is coming up on ${session.interviewAt.toLocaleString("en-US")}.`,
          meta: { interviewSessionId: session._id, jobId: job._id },
          email: {
            to: candidate.basicDetails.email,
            template: "interviewReminderEmailTemplate",
            args: [candidate, job, session],
          },
        });
      } catch (err) {
        console.error("[interviewReminderJob] failed to notify candidate:", err.message);
      }

      session[window.field] = true;
      await session.save();
    }
  }
}

function startInterviewReminderJob() {
  cron.schedule("*/15 * * * *", () => {
    sendDueReminders().catch((err) => console.error("[interviewReminderJob] run failed:", err.message));
  });
  console.log("[interviewReminderJob] scheduled every 15 minutes");
}

module.exports = { startInterviewReminderJob };
