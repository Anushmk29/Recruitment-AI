const mongoose = require("mongoose");
const { STAGES, REJECTED } = require("../utils/pipeline");

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

const stageHistorySchema = new mongoose.Schema(
  {
    stage: { type: String, required: true },
    note: { type: String, trim: true },
    // Actor that drove the transition: an admin's name/email, or "system" for
    // automated moves (ATS, interview completion).
    by: { type: String, trim: true, default: "system" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const offerSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["none", "sent", "accepted", "declined"], default: "none" },
    message: { type: String, trim: true },
    sentAt: { type: Date },
    respondedAt: { type: Date },
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
    // "review" = the evidence engine's honest middle band (Phase 6) — a human
    // decides; it must never be treated as a fail by any consumer.
    decision: { type: String, enum: ["pending", "pass", "fail", "review"], default: "pending" },
    scoredAt: { type: Date },
    // Which engine produced the headline number: legacy keyword engine,
    // the evidence engine, or legacy-as-labelled-fallback after an evidence
    // failure. Uncertainty must be visible (engineering rule 5).
    engine: { type: String, enum: ["legacy", "evidence", "fallback-legacy"], default: "legacy" },
  },
  { _id: false }
);

// Hostility report from resumeDefenseService (Phase 4). Flags, never decides:
// nothing in here may drive an automated adverse action. Spans index into the
// canonical `resumeText` string (immutable once extracted).
const hostilitySpanSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    quote: { type: String, required: true },
    page: { type: Number, default: null },
  },
  { _id: false }
);

const hostilitySignalSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    severity: { type: String, enum: ["critical", "warning", "advisory"], required: true },
    message: { type: String, required: true },
    spans: { type: [hostilitySpanSchema], default: [] },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const hostilitySchema = new mongoose.Schema(
  {
    version: { type: String },
    analyzedAt: { type: Date },
    engine: { type: String, enum: ["deterministic", "deterministic+llm", "disabled"] },
    signals: { type: [hostilitySignalSchema], default: [] },
    excludedFromModel: {
      type: [
        new mongoose.Schema(
          {
            start: { type: Number, required: true },
            end: { type: Number, required: true },
            quote: { type: String, required: true },
            codes: { type: [String], default: [] },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    clean: { type: Boolean, default: true },
  },
  { _id: false }
);

const candidateSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },

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
    resumeSizeBytes: { type: Number }, // set at upload — feeds the storage quota (Phase 11)
    resumeText: { type: String, default: "" },
    // sha256 of the canonical resumeText — the identity key for ClaimGraph
    // reuse and the reproducibility hash (Phases 5-6).
    resumeHash: { type: String, default: "" },

    hostility: { type: hostilitySchema },

    ats: { type: atsResultSchema, default: () => ({}) },

    // Current hiring-pipeline stage. Ordered stages live in utils/pipeline.js;
    // `rejected` is the terminal off-ramp. Legacy values (interview_queue,
    // next_round) are normalized by the pipeline service before any save.
    status: {
      type: String,
      enum: [...STAGES, REJECTED],
      default: "applied",
    },

    // Append-only audit trail of every stage the candidate has passed through.
    stageHistory: { type: [stageHistorySchema], default: () => [] },

    offer: { type: offerSchema, default: () => ({}) },

    // Phase 15.1 — where this application came from (?src= on the apply link).
    // Analytics data ONLY: nothing in any scoring path may read this — a
    // referral must never score differently because it is a referral.
    source: {
      channel: { type: String, trim: true, lowercase: true, maxlength: 40 },
      campaign: { type: String, trim: true, maxlength: 80 },
      capturedAt: { type: Date },
    },

    // DPDP consent captured at application time. `aiProcessing` gates whether the
    // candidate's resume/answers may be sent to the external LLM — without it the
    // interview runs on the local deterministic engine so no PII leaves the system.
    consent: {
      aiProcessing: { type: Boolean, default: false },
      dataProcessing: { type: Boolean, default: false },
      at: { type: Date },
      ipAddress: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

// Compound indexes matching the hot read paths (Wave 6 / F11). The leading `company`
// also serves the tenant-scope plugin's injected {company} equality, so the standalone
// single-field company index was dropped as a redundant prefix.
// Recruiter board lists a job's applicants newest-first (candidateController.listCandidatesForJob).
candidateSchema.index({ company: 1, job: 1, createdAt: -1 });
// Retention job scans a tenant's candidates by last-touched time (jobs/retentionJob).
candidateSchema.index({ company: 1, updatedAt: 1 });
// Candidate dashboard + notification ownership resolve applications by the account email,
// across companies (runs outside tenant scope).
candidateSchema.index({ "basicDetails.email": 1 });

candidateSchema.plugin(require("./plugins/tenantScope"));

module.exports = mongoose.model("Candidate", candidateSchema);
