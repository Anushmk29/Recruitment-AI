const mongoose = require("mongoose");

const deviceCheckSchema = new mongoose.Schema(
  {
    camera: { type: Boolean, default: false },
    microphone: { type: Boolean, default: false },
    screenShare: { type: Boolean, default: false },
    fullscreen: { type: Boolean, default: false },
    deviceCompatible: { type: Boolean, default: false },
    browserInfo: { type: String, trim: true },
    completedAt: { type: Date },
  },
  { _id: false }
);

const speedTestSchema = new mongoose.Schema(
  {
    downloadMbps: { type: Number },
    testedAt: { type: Date },
  },
  { _id: false }
);

const identityVerificationSchema = new mongoose.Schema(
  {
    photoPath: { type: String },
    status: { type: String, enum: ["pending", "captured"], default: "pending" },
    capturedAt: { type: Date },
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", required: true, unique: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    tokenHash: { type: String, required: true, unique: true, index: true },
    interviewAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    instructions: { type: String, trim: true },

    status: { type: String, enum: ["scheduled", "in_progress", "expired", "cancelled"], default: "scheduled" },
    accessedAt: { type: Date },
    startedAt: { type: Date },

    deviceCheck: { type: deviceCheckSchema, default: () => ({}) },
    speedTest: { type: speedTestSchema, default: () => ({}) },
    identityVerification: { type: identityVerificationSchema, default: () => ({}) },

    reminder24hSent: { type: Boolean, default: false },
    reminder1hSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
