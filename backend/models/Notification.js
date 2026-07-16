const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    type: {
      type: String,
      enum: [
        "welcome",
        "interview_invite",
        "application_submitted",
        "ats_result_pass",
        "ats_result_fail",
        "interview_reminder",
        "interview_completed",
        "next_round_scheduled",
        "offer_letter",
        "rejection",
        "profile_updated",
        "password_changed",
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

module.exports = mongoose.model("Notification", notificationSchema);
