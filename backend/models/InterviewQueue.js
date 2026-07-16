const mongoose = require("mongoose");

const interviewQueueSchema = new mongoose.Schema(
  {
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", required: true, unique: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    atsScore: { type: Number, required: true },
    status: { type: String, enum: ["queued", "removed"], default: "queued" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InterviewQueue", interviewQueueSchema);
