const mongoose = require("mongoose");

const deviceCheckSchema = new mongoose.Schema(
  {
    camera: { type: Boolean, default: false },
    microphone: { type: Boolean, default: false },
    screenShare: { type: Boolean, default: false },
    fullscreen: { type: Boolean, default: false },
    deviceCompatible: { type: Boolean, default: false },
    browserInfo: { type: String, trim: true },

    // Audio isolation (barge-in prerequisite). Measured, not guessed from device labels: the
    // browser plays a test tone while listening on the microphone, so what gets recorded is the
    // echo path that actually exists AFTER the browser's echo cancellation — the only thing that
    // determines whether the interviewer can safely keep listening while it speaks.
    //   isolated     — the mic does not hear the output. Interruption is safe.
    //   bleeding     — the mic clearly hears the output (laptop speakers). Interruption would make
    //                  the interviewer interrupt ITSELF, so it stays off for this session.
    //   inconclusive — could not measure. Fails closed to "off".
    // NEVER a blocker: a candidate with no headphones simply gets the turn-based interview, which
    // is the same interview everyone got before this existed. Blocking them would be a fairness
    // problem dressed up as a quality bar.
    echoPath: { type: String, enum: ["isolated", "bleeding", "inconclusive"], default: "inconclusive" },
    echoRatio: { type: Number }, // measured tone-to-baseline mic level, for diagnosing complaints
    audioOutputConfirmed: { type: Boolean, default: false }, // the candidate said they heard the tone
    bargeInEligible: { type: Boolean, default: false },

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
//
// "warmup" / "warmup_answer" are the opening "tell me a bit about yourself" exchange. They are
// a real turn a reviewer should see, but deliberately NOT a question of the instrument: a
// self-introduction is not scoreable against a role rubric, it is not tied to a claim-probe,
// and it does not consume the question budget. The kind is what keeps it out of the score —
// see aiInterviewService (scoreUnscoredAnswers skips it, and submitAnswer never assigns it an
// answerScore).
const interviewTurnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["ai", "candidate"], required: true },
    kind: {
      type: String,
      enum: ["intro", "warmup", "warmup_answer", "question", "answer", "closing"],
      default: "question",
    },
    text: { type: String, required: true },
    topic: { type: String, trim: true },
    difficulty: { type: String, enum: ["easy", "medium", "hard"] },
    answerScore: { type: Number },
    // Which claim-probe this question addresses (Phase 8), when any.
    probeId: { type: String },
    // Which approved must-ask question this turn delivered, when any. Stamped so "which approved
    // question produced this answer" is a lookup rather than a string comparison against text
    // that may since have been superseded by a newer version of the set.
    mustAskId: { type: String },
    // On a candidate ANSWER: why the turn ended (utils/endpointing.js). "complete" means the
    // answer was classified as finished, "holding"/"ambiguous" that the interviewer waited and
    // eventually moved on, "manual" that the candidate ended it themselves. A condition of the
    // interview, never an input to a score — see the sanitizer in interviewPortalController.
    endOfTurn: {
      state: { type: String, enum: ["complete", "ambiguous", "holding", "manual"] },
      reason: { type: String, trim: true },
    },
    // How many times the candidate asked to hear THIS question again (set on the question turn).
    //
    // RECORDED, NEVER SCORED — and that exclusion is deliberate, not an oversight. Repeat requests
    // correlate with accent, hearing, whether English is a first language, and connection quality;
    // they correlate weakly at best with ability to do the job. Feeding this into any score would
    // build a disparate-impact machine. It exists so a human reviewing the interview can see the
    // conditions it ran under, and so "the audio was bad" is evidenced rather than argued.
    // The repeat replays the same authored text — the same audio bytes — so a candidate who asks
    // twice hears exactly what everyone else heard once.
    repeatCount: { type: Number },
    // Was this question actually finished before the candidate started answering? On devices where
    // barge-in is enabled they can talk over it, and a question the candidate talked over was not
    // fully asked — so it must not silently count as having covered its claim-probe. Absent on
    // typed interviews and on the turn-based voice path, where delivery is complete by definition.
    deliveredFully: { type: Boolean },
    interruptedAtChar: { type: Number }, // approximate character offset where they cut in
    // Voice metadata — present on spoken candidate answers (inputMode "voice").
    // (A dead `audioPath` field used to sit here — declared, never written. Removed
    // in Phase 9.6: answer audio is not retained; only the transcript is.)
    inputMode: { type: String, enum: ["text", "voice"], default: "text" },
    audioDurationMs: { type: Number },
    transcriptConfidence: { type: Number }, // STT confidence 0-1
    acoustic: { type: acousticSchema },
    // How many of the interviewer's own backchannel phrases had to be stripped out of this
    // transcript (utils/backchannel.stripEcho). Normally 0 — the client pauses capture around
    // playback. A non-zero count means echo suppression is not holding on that device, which
    // is worth knowing BEFORE it shows up as a strange-looking answer.
    backchannelEchoRemoved: { type: Number },
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
// One recruiter-approved must-ask question, copied onto the session at start. Coverage state
// mirrors interviewProbeSchema: pending until delivered, and back to pending if the candidate
// talked over it, so a half-heard question never counts as asked.
const interviewMustAskSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true }, // id within the approved set version
    text: { type: String, required: true },
    topic: { type: String, default: "" },
    status: { type: String, enum: ["pending", "asked"], default: "pending" },
    turnIndex: { type: Number },
    askedAt: { type: Date },
  },
  { _id: false }
);

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

// One non-evaluative interviewer utterance: "take your time — I'm here", an acknowledgement, a
// repeat preamble. Drawn from a fixed human-approved bank (utils/backchannel.js) and recorded
// here — deliberately OUTSIDE `turns` — because a backchannel is not part of the test
// instrument. Recorded so the real conditions of the interview are reconstructible; never
// scored, never counted as a question, never shown to a reviewer as one.
const backchannelSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["reassure", "repeat", "acknowledge", "confirm"], required: true },
    phrase: { type: String, required: true },
    turnIndex: { type: Number }, // index in `turns` of the answer this happened during
    at: { type: Date, default: Date.now },
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
    // Non-evaluative interviewer speech, kept out of `turns` on purpose. See backchannelSchema.
    backchannels: { type: [backchannelSchema], default: () => [] },
    // Every attempt to make the interviewer say something that was NOT authored by the
    // rubric-bound engine and was NOT in the approved phrase bank (utils/speechAuthorization.js).
    // Normally empty, permanently: the allowed set is exactly what this server produced, so an
    // entry here means a bug or tampering. It is recorded verbatim rather than counted, because
    // "what did the interviewer say to this candidate?" is the question a discrimination claim
    // turns on, and a count cannot answer it.
    speechDivergences: {
      type: [
        new mongoose.Schema(
          {
            spoken: { type: String, required: true },
            enforced: { type: Boolean, default: true }, // was it refused, or only recorded?
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: () => [],
    },
    // Which interviewer persona this session ran under (models/PersonaProfile.js). Interviewer
    // warmth, voice and patience change how candidly candidates answer, so they are part of the
    // test conditions: comparing two candidates is only legitimate if both were interviewed under
    // the same ones, and defending a decision means being able to say what they were.
    // `source: "default"` means the tenant had approved no persona and the deployment fallback
    // was used — surfaced as such, never passed off as a tenant choice.
    persona: {
      key: { type: String, trim: true },
      version: { type: Number },
      name: { type: String, trim: true },
      voiceProvider: { type: String, trim: true },
      voiceModel: { type: String, trim: true },
      source: { type: String, enum: ["tenant", "default"] },
      at: { type: Date },
    },
    // The recruiter-approved must-ask questions for this job (models/QuestionSet.js), copied
    // onto the session at start. Copied rather than referenced on purpose: the set is frozen
    // once approved, but a session must be able to state exactly what it asked even if the set
    // is later archived — and coverage is per-session state, not per-set.
    //
    // Required coverage in the same sense as `probes`: the interview cannot close while any of
    // these is still pending. Unlike probes, they are asked VERBATIM and selected by code — a
    // reworded approved question is a different question, and "we asked everyone the same thing"
    // stops being true the moment a model paraphrases for one candidate and not another.
    mustAsk: { type: [interviewMustAskSchema], default: () => [] },
    // Which approved set this session ran under. `source: "none"` means the job had no approved
    // set and the interview ran on claim-probes plus adaptive questions — surfaced as such,
    // never passed off as a recruiter's choice.
    questionSet: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "QuestionSet" },
      version: { type: Number },
      source: { type: String, enum: ["approved_set", "none", "lookup_failed"] },
      at: { type: Date },
    },
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

    // The exact speech-to-text keyterm vocabulary this session's transcripts were biased with
    // (utils/keyterms.js). Recorded, NEVER scored: it exists so a candidate who disputes a
    // transcript can have it reconstructed instead of argued about, and so a bias audit can
    // confirm every candidate for a role was given the same role-derived vocabulary.
    voiceAsr: {
      keyterms: { type: [String], default: [] },
      model: { type: String, trim: true },
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
