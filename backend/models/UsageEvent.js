const mongoose = require("mongoose");

// One metered LLM call. Gives per-tenant cost attribution + budget enforcement (W3)
// AND doubles as the AI-decision audit trail (W4): every call records the model,
// tokens, latency, and whether real AI or the deterministic fallback produced it.
const usageEventSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSession" },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },

    kind: { type: String, enum: ["plan", "question", "evaluation", "other"], default: "other" },
    provider: { type: String, trim: true },
    model: { type: String, trim: true },

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
