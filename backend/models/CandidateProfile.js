const mongoose = require("mongoose");

const candidateProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    headline: { type: String, trim: true },
    location: { type: String, trim: true },
    skills: { type: [String], default: [] },
    bio: { type: String, trim: true },

    savedJobs: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Job" }], default: [] },

    profileCompletionPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CandidateProfile", candidateProfileSchema);
