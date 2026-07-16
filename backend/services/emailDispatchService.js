const EmailLog = require("../models/EmailLog");
const { sendMail } = require("../utils/mailer");
const { getEmailQueue } = require("../queues/emailQueue");

async function sendInline(log, attempt = 1) {
  try {
    await sendMail({ to: log.to, subject: log.subject, text: log.text, html: log.html });
    log.status = "sent";
    log.attempts = attempt;
    log.sentAt = new Date();
    await log.save();
  } catch (err) {
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return sendInline(log, attempt + 1);
    }
    log.status = "failed";
    log.attempts = attempt;
    log.error = err.message;
    await log.save();
    console.error(`[emailDispatchService] failed to send email to ${log.to}:`, err.message);
  }
}

// Every notification email (new or pre-existing) funnels through here so it
// gets an EmailLog audit trail and, when REDIS_URL is configured, real
// queue-based delivery with BullMQ's built-in retry/backoff. Without Redis
// configured (this project's default local setup) it sends inline with one
// manual retry, mirroring the try/catch-and-log pattern already used
// throughout the codebase for email sends.
async function dispatchEmail({ to, subject, text, html, category, relatedType, relatedId }) {
  if (!to) return null;

  const log = await EmailLog.create({ to, subject, text, html, category, relatedType, relatedId, status: "queued" });

  const queue = getEmailQueue();
  if (queue) {
    await queue.add(
      "send-email",
      { logId: String(log._id), to, subject, text, html },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: false }
    );
    return log;
  }

  await sendInline(log);
  return log;
}

module.exports = { dispatchEmail };
