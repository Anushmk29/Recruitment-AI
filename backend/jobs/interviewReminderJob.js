const cron = require("node-cron");
const InterviewSession = require("../models/InterviewSession");
const Candidate = require("../models/Candidate");
const Job = require("../models/Job");
const User = require("../models/User");
const tenantContext = require("../utils/tenantContext");
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
    }).select("_id");

    for (const { _id } of sessions) {
      // Atomic claim-before-send: only the worker that flips the flag from false→true
      // sends this reminder. Safe even if the reminder job runs on more than one worker,
      // and dedupes the read-then-write race that could double-email at scale.
      const claimed = await InterviewSession.findOneAndUpdate(
        { _id, [window.field]: false },
        { $set: { [window.field]: true } },
        { new: true }
      );
      if (!claimed) continue; // another worker already claimed it

      const candidate = await Candidate.findById(claimed.candidate);
      const job = await Job.findById(claimed.job);
      if (!candidate || !job) continue;

      const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });

      try {
        await notifyCandidate({
          candidateId: candidate._id,
          userId: applicantUser?._id,
          type: "interview_reminder",
          title: `Interview reminder: ${job.title}`,
          message: `Your interview for ${job.title} is coming up on ${claimed.interviewAt.toLocaleString("en-US")}.`,
          meta: { interviewSessionId: claimed._id, jobId: job._id },
          email: {
            to: candidate.basicDetails.email,
            template: "interviewReminderEmailTemplate",
            args: [candidate, job, claimed],
          },
        });
      } catch (err) {
        console.error("[interviewReminderJob] failed to notify candidate:", err.message);
        // Send failed — release the claim so a later tick retries instead of silently dropping it.
        await InterviewSession.updateOne({ _id: claimed._id }, { $set: { [window.field]: false } });
      }
    }
  }
}

function startInterviewReminderJob() {
  cron.schedule("*/15 * * * *", () => {
    // Runs across all tenants — mark trusted so the tenantScope guardrail doesn't scope it.
    tenantContext
      .runAsSystem(() => sendDueReminders())
      .catch((err) => console.error("[interviewReminderJob] run failed:", err.message));
  });
  console.log("[interviewReminderJob] scheduled every 15 minutes");
}

module.exports = { startInterviewReminderJob };
