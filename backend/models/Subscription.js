const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
    billingCycle: { type: String, enum: ["monthly", "yearly"], required: true },
    status: { type: String, enum: ["trialing", "active", "past_due", "cancelled"], default: "active" },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    expiryReminderSentAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
