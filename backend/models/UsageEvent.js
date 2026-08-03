const mongoose = require("mongoose");

// One metered LLM call. Gives per-tenant cost attribution + budget enforcement (W3)
// AND doubles as the AI-decision audit trail (W4): every call records the model,
// tokens, latency, and whether real AI or the deterministic fallback produced it.
const usageEventSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSession" },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },

    // Which feature spent this call (Phase 2.3 kind-tagged metering): interview
    // turns already tag plan/question/evaluation; rubric_compile, claim_extract,
    // match, probe_gen and report are reserved for Phases 3-8 so per-feature unit
    // economics and Phase 11 quotas can tell them apart.
    //
    // `autofill` is spend on the CANDIDATE's side of the funnel (résumé → form
    // suggestions), before an application exists. It is metered to the job's
    // tenant for visibility but deliberately draws no quota — a tenant must not
    // be billed against their screening allowance for applicants who never
    // finish applying.
    //
    // `intent` is the live conversational classifier (services/intentService.js):
    // many small calls per interview, one per utterance the deterministic matchers
    // could not read. Tagged separately because its cost curve is nothing like a
    // per-turn call — it scales with how much the candidate talks, not with how
    // many questions were asked — and conflating the two would make interview unit
    // economics unreadable.
    kind: {
      type: String,
      enum: ["plan", "question", "evaluation", "rubric_compile", "question_set_compile", "claim_extract", "match", "probe_gen", "verdict", "report", "stt", "tts", "autofill", "intent", "other"],
      default: "other",
    },
    provider: { type: String, trim: true },
    model: { type: String, trim: true },
    // Prompt template version that produced this call (Phase 2.6) — required to
    // reproduce a decision months later in a legal context.
    promptVersion: { type: String, trim: true },
    // True when the deterministic cache served the result (zero tokens spent).
    cached: { type: Boolean, default: false },

    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costCents: { type: Number, default: 0 },
    latencyMs: { type: Number },
    engine: { type: String, enum: ["ai", "fallback"], default: "ai" },
  },
  { timestamps: true }
);

// Month-to-date spend aggregation scans by company + createdAt. Leading company also
// covers the tenant-scope plugin's injected equality (redundant single-field index dropped).
usageEventSchema.index({ company: 1, createdAt: -1 });

usageEventSchema.plugin(require("./plugins/tenantScope"));

module.exports = mongoose.model("UsageEvent", usageEventSchema);
