const mongoose = require("mongoose");

const resumeSchema = new mongoose.Schema(
  {
    candidateEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    originalName: { type: String, required: true },
    storedFileName: { type: String, required: true },
    filePath: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true, index: true },
    extractedText: { type: String, default: "" },
    extractionStatus: {
      type: String,
      enum: ["success", "empty", "failed"],
      default: "success",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Resume", resumeSchema);
