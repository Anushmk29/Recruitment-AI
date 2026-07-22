const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, sparse: true, index: true },
    department: { type: String, trim: true },
    location: { type: String, trim: true },
    description: { type: String, required: true },
    requirements: { type: String },
    status: { type: String, enum: ["draft", "published", "closed"], default: "draft" },

    requiredSkills: { type: [String], default: [] },
    minExperienceYears: { type: Number, default: 0 },
    requiredEducation: { type: String, trim: true },
    atsThreshold: { type: Number, default: 60, min: 0, max: 100 },
    interviewInstructions: { type: String, trim: true },
  },
  { timestamps: true }
);

jobSchema.statics.findByIdOrSlug = function (idOrSlug) {
  if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
    return this.findOne({ $or: [{ _id: idOrSlug }, { slug: idOrSlug }] });
  }
  return this.findOne({ slug: idOrSlug });
};

// Recruiter job list — a tenant's jobs newest-first (jobController.listJobs). Leading
// `company` also covers the tenant-scope plugin's injected equality (redundant single-field
// company index dropped).
jobSchema.index({ company: 1, createdAt: -1 });
// Public job board — published jobs newest-first, across tenants (jobController.listPublicJobs).
jobSchema.index({ status: 1, createdAt: -1 });

jobSchema.plugin(require("./plugins/tenantScope"));

module.exports = mongoose.model("Job", jobSchema);
