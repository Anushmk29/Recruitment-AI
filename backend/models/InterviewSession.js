const mongoose = require("mongoose");

const deviceCheckSchema = new mongoose.Schema(
  {
    camera: { type: Boolean, default: false },
    microphone: { type: Boolean, default: false },
    screenShare: { type: Boolean, default: false },
    fullscreen: { type: Boolean, default: false },
    deviceCompatible: { type: Boolean, default: false },
    browserInfo: { type: String, trim: true },
    completedAt: { type: Date },
  },
  { _id: false }
);

const speedTestSchema = new mongoose.Schema(
  {
    downloadMbps: { type: Number },
    testedAt: { type: Date },
  },
  { _id: false }
);

const identityVerificationSchema = new mongoose.Schema(
  {
    photoPath: { type: String },
    status: { type: String, enum: ["pending", "captured"], default: "pending" },
    capturedAt: { type: Date },
  },
  { _id: false }
);

// One recorded integrity event during the interview (a capped recent tail is kept for the admin
// timeline; per-type `counts` on the parent are the authoritative tally). `severity` and the risk
// score are assigned server-side from the type — the client only reports the type + a little meta.
const proctoringEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    severity: { type: String, enum: ["low", "medium", "high"], default: "low" },
    meta: { type: mongoose.Schema.Types.Mixed },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Proctoring / anti-cheat state for the interview. Browser signals (tab-switch, fullscreen exit,
// copy/paste) + in-browser vision (face presence, multi-face, gaze, identity match) stream in as
// events; the derived `riskScore` is deterministic (utils/proctoring.js). Advisory only — never
// auto-rejects. Camera/vision processing runs entirely in the candidate's browser: only event
// metadata reaches the server, never raw video (DPDP-friendly).
const proctoringSchema = new mongoose.Schema(
  {
    consent: {
      given: { type: Boolean, default: false },
      declined: { type: Boolean, default: false },
      at: { type: Date },
    },
    // Phase 14.3 — clip capture is a SEPARATE, explicit consent clause on top of
    // the base proctoring consent. Without `given`, the client rolling buffer
    // never starts AND the server refuses clip uploads (defence in depth).
    // `wordingVersion` records which consent text the candidate accepted;
    // a decline is recorded, not just an absence of consent.
    evidenceConsent: {
      given: { type: Boolean, default: false },
      declined: { type: Boolean, default: false },
      at: { type: Date },
      wordingVersion: { type: String, trim: true },
    },
    // Phase 14.6 — secondary phone camera presence. The phone NEVER streams
    // continuously; it sends a heartbeat, and heartbeat staleness raises a
    // phone_cam_lost event in the risk model (checked on the laptop's flush).
    phoneCam: {
      paired: { type: Boolean, default: false },
      pairedAt: { type: Date },
      lastHeartbeatAt: { type: Date },
      lostFlagged: { type: Boolean, default: false },
    },
    visionEnabled: { type: Boolean, default: false }, // in-browser face detection was active
    riskScore: { type: Number, default: 0 }, // 0-100, derived server-side
    riskBand: { type: String, enum: ["low", "medium", "high"], default: "low" },
    counts: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }, // { [type]: occurrences }
    totalEvents: { type: Number, default: 0 },
    identityMatch: {
      status: { type: String, enum: ["unknown", "match", "mismatch"], default: "unknown" },
      distance: { type: Number }, // face-descriptor euclidean distance (lower = closer match)
      checkedAt: { type: Date },
    },
    events: { type: [proctoringEventSchema], default: () => [] }, // capped recent tail
    lastEventAt: { type: Date },
  },
  { _id: false }
);

// Raw prosody measurements for a spoken answer, computed in-browser during recording. These
// are inputs; the derived delivery/confidence score is computed server-side (not client-trusted).
const acousticSchema = new mongoose.Schema(
  {
    wordsPerMinute: { type: Number },
    pauseRatio: { type: Number }, // fraction of the answer that was silence
    fillerRate: { type: Number }, // filler words ("um", "uh") per 100 words
    pitchVariance: { type: Number },
    energyVariance: { type: Number },
    deliveryScore: { type: Number }, // 0-100, derived server-side (V3)
  },
  { _id: false }
);

// One conversational turn of the AI interview. `role` is who spoke; `kind`
// classifies the turn so the UI and evaluator can distinguish intro/question/
// answer/closing. `answerScore` is the AI's per-answer 0-100 judgement (only on
// candidate answers).
const interviewTurnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["ai", "candidate"], required: true },
    kind: { type: String, enum: ["intro", "question", "answer", "closing"], default: "question" },
    text: { type: String, required: true },
    topic: { type: String, trim: true },
    difficulty: { type: String, enum: ["easy", "medium", "hard"] },
    answerScore: { type: Number },
    // Which claim-probe this question addresses (Phase 8), when any.
    probeId: { type: String },
    // Voice metadata — present on spoken candidate answers (inputMode "voice").
    // (A dead `audioPath` field used to sit here — declared, never written. Removed
    // in Phase 9.6: answer audio is not retained; only the transcript is.)
    inputMode: { type: String, enum: ["text", "voice"], default: "text" },
    audioDurationMs: { type: Number },
    transcriptConfidence: { type: Number }, // STT confidence 0-1
    acoustic: { type: acousticSchema },
    // Per-turn provenance so a mixed AI/fallback interview is auditable turn-by-turn.
    engine: { type: String, enum: ["ai", "fallback"] },
    model: { type: String, trim: true },
    latencyMs: { type: Number },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// One claim-probe (Phase 8): an interview question generated from a specific
// unverified high-weight resume claim, with its verdict conditions precomputed
// at generation time so the post-interview verdict is judged against stated
// criteria. A `contradicted` verdict NEVER auto-rejects — it surfaces to a
// human with the resume quote and the answer quote side by side.
const interviewProbeSchema = new mongoose.Schema(
  {
    claimId: { type: String, required: true },
    criterionId: { type: String, default: "" },
    question: { type: String, required: true },
    whatWouldVerify: { type: String, default: "" },
    whatWouldContradict: { type: String, default: "" },
    resumeQuote: { type: String, default: "" }, // the claim's cited span, for side-by-side display
    status: { type: String, enum: ["pending", "asked", "assessed"], default: "pending" },
    turnIndex: { type: Number }, // index of the question turn that asked it
    verdict: { type: String, enum: ["verified", "contradicted", "inconclusive"] },
    verdictReasoning: { type: String },
    answerQuote: { type: String }, // verbatim from the transcript, code-verified
    askedAt: { type: Date },
    assessedAt: { type: Date },
  },
  { _id: false }
);

const interviewPlanSchema = new mongoose.Schema(
  {
    role: { type: String, trim: true },
    difficultyEstimate: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    topics: { type: [String], default: [] },
    focusAreas: { type: [String], default: [] },
    summary: { type: String, trim: true },
  },
  { _id: false }
);

const interviewEvaluationSchema = new mongoose.Schema(
  {
    overallScore: { type: Number },
    communication: { type: Number },
    technicalKnowledge: { type: Number },
    problemSolving: { type: Number },
    // Voice-only: derived from answer prosody (0-100), present when the interview was spoken.
    delivery: { type: Number },
    confidence: { type: Number },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    // "review" = no automated recommendation; requires human judgement. The deterministic
    // fallback ALWAYS emits "review" — it must never produce an adverse hiring decision.
    recommendation: { type: String, enum: ["strong_hire", "hire", "maybe", "no_hire", "review"] },
    summary: { type: String, trim: true },
    generatedBy: { type: String, enum: ["ai", "fallback"], default: "ai" },
    generatedAt: { type: Date },
    // Provenance for reproducibility / legal defensibility of an automated decision (W4).
    model: { type: String, trim: true },
    provider: { type: String, trim: true },
    promptVersion: { type: String, trim: true },
    temperature: { type: Number },
    promptTokens: { type: Number },
    completionTokens: { type: Number },
    latencyMs: { type: Number },
  },
  { _id: false }
);

// The text-first AI interview state embedded on the session (1:1 with the
// candidate). See services/aiInterviewService.js for the orchestration.
const aiInterviewSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["not_started", "in_progress", "completed"], default: "not_started" },
    engine: { type: String, enum: ["ai", "fallback"], default: "ai" },
    // How the candidate answered — set to "voice" once any spoken answer is received.
    modality: { type: String, enum: ["text", "voice"], default: "text" },
    plan: { type: interviewPlanSchema, default: () => ({}) },
    currentDifficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    turns: { type: [interviewTurnSchema], default: () => [] },
    askedQuestions: { type: [String], default: () => [] },
    questionCount: { type: Number, default: 0 },
    // Length bounds (Phase 8.3): the interview may end early once ALL probes
    // are covered AND minQuestions is reached; maxQuestions is the hard ceiling.
    minQuestions: { type: Number, default: 5 },
    maxQuestions: { type: Number, default: 8 },
    // Claim-probes this interview must cover (Phase 8.2 — required coverage).
    probes: { type: [interviewProbeSchema], default: () => [] },
    probeEngine: { type: String, enum: ["ai", "none"], default: "none" },
    probePromptVersion: { type: String },
    evaluation: { type: interviewEvaluationSchema, default: () => ({}) },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", required: true, unique: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    tokenHash: { type: String, required: true, unique: true, index: true },
    interviewAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    instructions: { type: String, trim: true },

    status: { type: String, enum: ["scheduled", "in_progress", "completed", "expired", "cancelled"], default: "scheduled" },
    accessedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },

    deviceCheck: { type: deviceCheckSchema, default: () => ({}) },
    speedTest: { type: speedTestSchema, default: () => ({}) },
    identityVerification: { type: identityVerificationSchema, default: () => ({}) },
    proctoring: { type: proctoringSchema, default: () => ({}) },

    // Voice consent (Phase 9.5) — recorded BEFORE any mic capture, mirroring the
    // proctoring consent gate. Without `given`, the server refuses to mint a
    // streaming token; declining leaves the type-to-answer path fully available.
    voiceConsent: {
      given: { type: Boolean, default: false },
      declined: { type: Boolean, default: false },
      at: { type: Date },
    },

    aiInterview: { type: aiInterviewSchema, default: () => ({}) },

    reminder24hSent: { type: Boolean, default: false },
    reminder1hSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Reminder cron scans scheduled sessions due within a time window, across tenants
// (jobs/interviewReminderJob). candidate and tokenHash are already uniquely indexed.
interviewSessionSchema.index({ status: 1, interviewAt: 1 });

interviewSessionSchema.plugin(require("./plugins/tenantScope"));

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
