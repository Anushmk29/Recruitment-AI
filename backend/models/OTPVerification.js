const mongoose = require("mongoose");

const otpVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    purpose: { type: String, enum: ["company_registration"], required: true },

    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },

    attempts: { type: Number, default: 0 },
    sendCount: { type: Number, default: 1 },
    lastSentAt: { type: Date, default: Date.now },

    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OTPVerification", otpVerificationSchema);
