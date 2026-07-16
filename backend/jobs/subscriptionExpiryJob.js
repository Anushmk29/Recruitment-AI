const cron = require("node-cron");
const Subscription = require("../models/Subscription");
const Company = require("../models/Company");
const { notifyAdmin } = require("../services/notificationService");

const REMINDER_WINDOW_DAYS = Number(process.env.SUBSCRIPTION_EXPIRY_REMINDER_DAYS) || 7;
const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function sendDueReminders() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const subscriptions = await Subscription.find({
    status: "active",
    currentPeriodEnd: { $gte: now, $lte: windowEnd },
    $or: [{ expiryReminderSentAt: null }, { expiryReminderSentAt: { $lt: new Date(now.getTime() - RESEND_COOLDOWN_MS) } }],
  }).populate("plan");

  for (const subscription of subscriptions) {
    const company = await Company.findById(subscription.company);
    if (!company) continue;

    try {
      await notifyAdmin({
        companyId: company._id,
        type: "subscription_renewal",
        title: "Subscription expiring soon",
        message: `Your ${company.name} subscription expires on ${subscription.currentPeriodEnd.toLocaleDateString("en-US")}.`,
        meta: { subscriptionId: subscription._id },
        email: {
          template: "subscriptionExpiryReminderEmailTemplate",
          args: (admin) => [company, admin, subscription],
        },
      });
    } catch (err) {
      console.error("[subscriptionExpiryJob] failed to notify admin:", err.message);
    }

    subscription.expiryReminderSentAt = now;
    await subscription.save();
  }
}

function startSubscriptionExpiryJob() {
  cron.schedule("0 8 * * *", () => {
    sendDueReminders().catch((err) => console.error("[subscriptionExpiryJob] run failed:", err.message));
  });
  console.log("[subscriptionExpiryJob] scheduled daily at 08:00");
}

module.exports = { startSubscriptionExpiryJob };
