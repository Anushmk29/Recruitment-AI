const mongoose = require("mongoose");

const companySettingsSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },

    branding: {
      useCustomBranding: { type: Boolean, default: false },
      primaryColor: { type: String, default: "#1a2a44" },
    },

    emailTemplatePreferences: {
      useDefaultTemplates: { type: Boolean, default: true },
      replyToEmail: { type: String },
    },

    notificationPreferences: {
      emailOnNewApplication: { type: Boolean, default: true },
      emailOnAtsResult: { type: Boolean, default: true },
      emailOnInterviewCompleted: { type: Boolean, default: true },
    },

    dashboardPreferences: {
      defaultView: { type: String, default: "overview" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CompanySettings", companySettingsSchema);
