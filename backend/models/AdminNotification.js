const mongoose = require("mongoose");

const adminNotificationSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    type: {
      type: String,
      enum: [
        "email_verified",
        "workspace_ready",
        "payment_success",
        "payment_failed",
        "invoice_generated",
        "subscription_renewal",
        "new_candidate_applied",
        "ats_completed",
        "candidate_shortlisted",
        "candidate_rejected",
        "interview_completed",
        "ai_report_ready",
        "password_changed",
        "system_alert",
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);
