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

    // Per-tenant AI interview configuration. `model` overrides the global
    // AI_INTERVIEW_MODEL; `monthlyBudgetCents` caps spend (0 = uncapped); when
    // `hardCap` is true the engine degrades to the deterministic fallback once the
    // budget is exhausted instead of continuing to spend.
    ai: {
      model: { type: String, trim: true },
      // Per-role model overrides (config/models.js registry roles). More specific
      // than `model` above, which historically means the interview role only.
      models: {
        interview: { type: String, trim: true },
        extraction: { type: String, trim: true },
        reasoning: { type: String, trim: true },
        cheap: { type: String, trim: true },
      },
      monthlyBudgetCents: { type: Number, default: 0, min: 0 },
      hardCap: { type: Boolean, default: true },
      temperature: { type: Number, default: 0, min: 0, max: 2 },
      // Per-tenant evidence-engine rollout (Phase 6): legacy | shadow | live.
      // Unset ⇒ the ATS_ENGINE env default applies.
      atsEngine: { type: String, enum: ["legacy", "shadow", "live"] },
    },

    // Phase 14 — integrity-evidence rollout, per tenant. Unset ⇒ the
    // EVIDENCE_CLIPS_ENABLED / SECONDARY_CAM_ENABLED env defaults apply
    // (both default OFF). Off = exactly the pre-Phase-14 counts-only behaviour.
    proctoring: {
      evidenceClips: { type: Boolean },
      secondaryCam: { type: Boolean },
    },

    // Assessment engine per-tenant gate (ASSESSMENT-ENGINE-PLAN §4 — gate 2 of 4:
    // env flag → THIS → Job.assessmentPolicy → per-candidate assignment). Unset ⇒
    // the ASSESSMENT_ENGINE_ENABLED env default applies; explicit false wins.
    assessments: {
      enabled: { type: Boolean },
    },

    // Phase 15 — distribution rollout, per tenant. Unset ⇒ the
    // CAREERS_PAGES_ENABLED / JOB_PUBLISHING_ENABLED env defaults apply.
    // Off ⇒ the public careers/feed routes 404 and the publish UI hides.
    careers: {
      enabled: { type: Boolean },
    },
    publishing: {
      enabled: { type: Boolean },
    },

    // Compliance / governance controls (DPDP + fair-hiring).
    compliance: {
      // Require explicit candidate consent before any resume/answer text is sent to
      // the external LLM. When required and not given, the interview runs on the
      // local deterministic engine (no PII leaves the system).
      aiConsentRequired: { type: Boolean, default: true },
      // Allow the ATS to auto-reject + email below-threshold candidates without human
      // review. Off by default — the safe/defensible default keeps a human in the loop.
      autoRejectAllowed: { type: Boolean, default: false },
      // Data-retention window for interview/resume artifacts (days). Enforced nightly by
      // jobs/retentionJob.js — candidate PII untouched for longer than this is hard-deleted.
      retentionDays: { type: Number, default: 365, min: 1 },
      // Grievance / Data-Protection Officer contact, surfaced to candidates (DPDP §5.2
      // data-principal rights). Shown on the apply form and returned by the public
      // /api/data-rights/dpo/:companyId endpoint.
      dpo: {
        name: { type: String, trim: true },
        email: { type: String, trim: true, lowercase: true },
        phone: { type: String, trim: true },
      },
    },
  },
  { timestamps: true }
);

companySettingsSchema.plugin(require("./plugins/tenantScope"));

module.exports = mongoose.model("CompanySettings", companySettingsSchema);
