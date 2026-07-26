// Versioned, recruiter-approved hiring rubric for one job (BUILD-PLAN Phase 3).
// This object is the fairness mechanism and the audit artifact: every candidate
// for the role is scored against the byte-identical FROZEN version, which is
// what makes cross-candidate comparison legitimate and a bias audit possible.
//
// Lifecycle: draft (editable) → approved + frozenAt set (immutable) → archived
// (when a newer version is approved). A JD edit never mutates an existing
// rubric — it compiles a NEW draft version (rubricService.supersede), so
// historical decisions keep pointing at the exact object that made them.

const mongoose = require("mongoose");

const criterionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["must_have", "nice_to_have", "disqualifier"], required: true },
    // Normalised in code (rubricEngine.normaliseWeights): scoreable weights sum
    // to exactly 1.0; disqualifiers are gates and always carry 0.
    weight: { type: Number, required: true, min: 0, max: 1 },
    // Non-empty by schema (guardrail): trim + required rejects "".
    rationale: { type: String, required: true, trim: true },
    evidenceTypes: {
      type: [{ type: String, enum: ["skill", "experience", "education", "project", "certification", "outcome"] }],
      default: [],
    },
    acceptableEvidence: { type: [String], default: [] },
    probeHint: { type: String, trim: true, default: "" }, // feeds Phase 8 interview probes
    seniorityFloor: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const qualityFlagSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "warning" },
    evidence: { type: String, trim: true }, // verbatim JD snippet that fired the flag
  },
  { _id: false }
);

const roleRubricSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["draft", "approved", "archived"], default: "draft" },

    // sha256 of the canonical JD text this was compiled from (rubricEngine.sourceHashOf).
    sourceHash: { type: String, required: true, trim: true },

    criteria: { type: [criterionSchema], default: [] },

    // Two thresholds, not one (Phase 6): >= advance ⇒ advance; < review ⇒ decline
    // (human-in-the-loop rules permitting); in between ⇒ route to human review.
    thresholds: {
      advance: { type: Number, min: 0, max: 100, default: 60 },
      review: { type: Number, min: 0, max: 100, default: 45 },
    },

    // Provenance (engineering rule 5 — degraded paths are labelled everywhere).
    compiledBy: {
      engine: { type: String, enum: ["ai", "fallback"], required: true },
      model: { type: String, trim: true },
      promptVersion: { type: String, trim: true },
      at: { type: Date },
    },
    approvedBy: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: { type: Date },
    },

    qualityFlags: { type: [qualityFlagSchema], default: [] },

    // Once set, the document is immutable (see hooks below).
    frozenAt: { type: Date },
  },
  { timestamps: true }
);

roleRubricSchema.index({ job: 1, version: 1 }, { unique: true });
roleRubricSchema.index({ company: 1, job: 1, status: 1 });

roleRubricSchema.path("thresholds.review").validate(function (v) {
  return !(Number.isFinite(v) && Number.isFinite(this.thresholds?.advance)) || v <= this.thresholds.advance;
}, "thresholds.review must not exceed thresholds.advance");

// --- Immutability (Phase 3 guardrail) ----------------------------------------
// A frozen rubric admits exactly ONE change: status → "archived" (how supersede
// retires an old approved version when its successor is approved). Everything
// else — criteria, weights, thresholds, flags — is rejected; changes create a
// new version, always.

// Pure checker, exported for unit tests: returns an error message, or null if
// the change is allowed. `modifiedPaths` may contain parent+child path entries.
function frozenViolation(wasFrozen, modifiedPaths, nextStatus) {
  if (!wasFrozen) return null;
  const disallowed = modifiedPaths.filter((p) => p !== "status" && p !== "updatedAt");
  if (disallowed.length) {
    return `RoleRubric is frozen — cannot modify [${disallowed.join(", ")}]; compile a new version instead`;
  }
  if (modifiedPaths.includes("status") && nextStatus !== "archived") {
    return `RoleRubric is frozen — status may only change to "archived", not "${nextStatus}"`;
  }
  return null;
}

// Capture frozen-ness at load time so a save can't dodge the guard by also
// overwriting frozenAt itself.
roleRubricSchema.post("init", function () {
  this.$locals.wasFrozen = Boolean(this.frozenAt);
});

roleRubricSchema.pre("save", function () {
  const violation = frozenViolation(Boolean(this.$locals?.wasFrozen), this.modifiedPaths(), this.status);
  if (violation) throw new Error(violation);
});

// Query-level updates bypass document middleware entirely, so they are banned
// outright for this collection — all writes go through load-modify-save in
// rubricService, where the frozen guard above can see them.
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne"]) {
  roleRubricSchema.pre(op, function () {
    throw new Error(`RoleRubric does not allow query-level ${op} — load the document and save via rubricService`);
  });
}

roleRubricSchema.plugin(require("./plugins/tenantScope"));

const RoleRubric = mongoose.model("RoleRubric", roleRubricSchema);
RoleRubric.frozenViolation = frozenViolation;
module.exports = RoleRubric;
