const mongoose = require("mongoose");

const adminNotificationSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
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
        "candidate_stage_changed",
        "candidate_selected",
        "candidate_joined",
        "offer_accepted",
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

// Notification list, newest-first (adminNotificationController.listMine). Leading company
// also covers the tenant-scope plugin's injected equality (redundant single-field index dropped).
adminNotificationSchema.index({ company: 1, createdAt: -1 });
// Unread badge count (adminNotificationController.unreadCount).
adminNotificationSchema.index({ company: 1, read: 1 });

adminNotificationSchema.plugin(require("./plugins/tenantScope"));

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);
