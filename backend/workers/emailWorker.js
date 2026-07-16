const { Worker } = require("bullmq");
const { getRedisConnection } = require("../config/redis");
const EmailLog = require("../models/EmailLog");
const { sendMail } = require("../utils/mailer");

function startEmailWorker() {
  const connection = getRedisConnection();
  if (!connection) return null;

  const worker = new Worker(
    "email",
    async (job) => {
      const { logId, to, subject, text, html } = job.data;
      await sendMail({ to, subject, text, html });
      await EmailLog.findByIdAndUpdate(logId, { status: "sent", sentAt: new Date(), $inc: { attempts: 1 } });
    },
    { connection }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 1);
    await EmailLog.findByIdAndUpdate(job.data.logId, {
      status: isFinalAttempt ? "failed" : "retrying",
      error: err.message,
      $inc: { attempts: 1 },
    });
    console.error(`[emailWorker] job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message);
  });

  console.log("[emailWorker] BullMQ email worker started");
  return worker;
}

module.exports = { startEmailWorker };
