const mongoose = require("mongoose");

const experienceSchema = new mongoose.Schema(
  {
    company: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    startDate: { type: String, trim: true },
    endDate: { type: String, trim: true },
    currentlyWorking: { type: Boolean, default: false },
    description: { type: String, trim: true },
  },
  { _id: false }
);

const educationSchema = new mongoose.Schema(
  {
    institution: { type: String, required: true, trim: true },
    degree: { type: String, required: true, trim: true },
    fieldOfStudy: { type: String, trim: true },
    startYear: { type: String, trim: true },
    endYear: { type: String, trim: true },
    grade: { type: String, trim: true },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    techStack: { type: String, trim: true },
    link: { type: String, trim: true },
  },
  { _id: false }
);

const certificateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    issuer: { type: String, trim: true },
    issueDate: { type: String, trim: true },
    credentialUrl: { type: String, trim: true },
  },
  { _id: false }
);

const atsResultSchema = new mongoose.Schema(
  {
    skillsMatch: { type: Number, default: 0 },
    experienceMatch: { type: Number, default: 0 },
    educationMatch: { type: Number, default: 0 },
    projectsMatch: { type: Number, default: 0 },
    certificationMatch: { type: Number, default: 0 },
    keywordMatch: { type: Number, default: 0 },
    missingSkills: { type: [String], default: [] },
    overallScore: { type: Number, default: 0 },
    threshold: { type: Number },
    decision: { type: String, enum: ["pending", "pass", "fail"], default: "pending" },
    scoredAt: { type: Date },
  },
  { _id: false }
);

const candidateSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    basicDetails: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, trim: true },
      location: { type: String, trim: true },
      linkedinUrl: { type: String, trim: true },
      portfolioUrl: { type: String, trim: true },
    },

    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    skills: { type: [String], default: [] },
    projects: { type: [projectSchema], default: [] },
    certificates: { type: [certificateSchema], default: [] },

    resumePath: { type: String, required: true },
    resumeOriginalName: { type: String },
    resumeText: { type: String, default: "" },

    ats: { type: atsResultSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ["applied", "interview_queue", "shortlisted", "next_round", "rejected"],
      default: "applied",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Candidate", candidateSchema);
