// HTTP surface for the realtime (speech-to-speech) interview — services/voiceAgentService.js.
//
// Deliberately a SEPARATE controller from interviewPortalController rather than three more
// handlers on the end of it. The realtime path is behind a flag and defaults off, and it has to be
// possible to read, review, and delete it as one unit without disturbing the turn-based pipeline
// that every live interview currently runs on.
//
// Auth is the portal's existing session JWT (requireCandidateAuth), so a realtime session is bound
// to exactly one InterviewSession the same way every other portal request is.

const CompanySettings = require("../models/CompanySettings");
const Candidate = require("../models/Candidate");
const voiceAgent = require("../services/voiceAgentService");
const guardrail = require("../utils/agentGuardrail");
const aiInterview = require("../services/aiInterviewService");
const usageService = require("../services/usageService");
const personaService = require("../services/personaService");

// How many of the agent's own utterances to retain per session. This is the audit record that
// replaces exact-match speech authorization, so it is generous — but bounded, because a candidate's
// browser is the thing posting them and an unbounded array is an unbounded write.
const MAX_AGENT_UTTERANCES = 400;
// Guardrail findings are the evidence in a complaint, so the tail is long. A well-behaved agent
// produces none at all; a misbehaving one produces the first few that identify the problem.
const MAX_GUARDRAIL_HITS = 100;
const MAX_UTTERANCE_CHARS = 2000;
const MAX_UTTERANCES_PER_FLUSH = 50;

// Is realtime on for this tenant? Nothing more.
//
// A SEPARATE endpoint from realtimeSession, and it has to be. The room needs to know which
// pipeline it is running before it opens anything, and asking that question by attempting to mint
// a session had two bugs baked in: it burned a Deepgram credential and started the billing clock
// on a probe, and it ran BEFORE voice consent, so it always came back 403 — meaning realtime could
// never activate at all, on any tenant, however it was configured.
//
// Deliberately requires no consent: this discloses nothing about the candidate and grants nothing.
async function realtimeAvailable(req, res) {
  const settings = await CompanySettings.findOne({ company: req.interviewSession.company }).select("ai compliance");
  res.json({ enabled: voiceAgent.isEnabled(settings) });
}

// Mint the connection credential + the Settings message the browser must relay.
//
// The browser receives a fully-formed Settings object it did not author and cannot meaningfully
// edit without the server noticing (the questions still come from function calls, which are
// re-derived from the session server-side). What it must NOT receive is anything reusable: the
// token is short-lived, and the OpenRouter key inside `settings.agent.think.endpoint.headers` is
// the one genuine secret on this path — see the note in the route file about why this endpoint is
// consent-gated and rate-limited exactly like the turn-based token.
async function realtimeSession(req, res) {
  const session = req.interviewSession;
  const settings = await CompanySettings.findOne({ company: session.company }).select("ai compliance");

  if (!voiceAgent.isEnabled(settings)) {
    // Not an error the candidate should ever see: the client falls back to the turn-based
    // pipeline, which is the interview everyone gets today.
    return res.status(404).json({ error: "Realtime voice interview is not enabled", code: "REALTIME_DISABLED" });
  }
  // Same hard gate as the turn-based path (Phase 9.5): no voice consent ⇒ no credential ⇒ the
  // microphone can never open.
  if (!session.voiceConsent?.given) {
    return res.status(403).json({ error: "Voice consent has not been given for this interview", code: "VOICE_CONSENT_REQUIRED" });
  }

  const candidate = await Candidate.findById(session.candidate).populate("job");
  if (!candidate) return res.status(404).json({ error: "Candidate not found for this interview" });

  // ---- The two gates the realtime path bypassed ---------------------------
  //
  // On the turn-based path `aiUsable()` checks AI-processing consent and the tenant's budget
  // before any model call, and falls back to the deterministic engine when either fails. Realtime
  // has no such fallback — the agent IS the model — so the checks have to happen here, at the one
  // moment the session can still be refused. Without them a candidate who declined AI processing
  // would have their voice sent to a model anyway (the agent's own calls go Deepgram → OpenRouter,
  // never through our metering), and a tenant past its cap could run unbounded spend.
  //
  // Refusing is not adverse: 404 is what the client reads as "not enabled", and it falls back to
  // the turn-based pipeline, which is the interview everyone gets today.
  if (!aiInterview.consentOk(candidate, settings)) {
    return res.status(403).json({
      error: "AI processing consent has not been given for this interview",
      code: "AI_CONSENT_REQUIRED",
    });
  }
  try {
    if (await usageService.isOverBudget(session.company, settings?.ai)) {
      console.warn(`[voiceAgent] company ${session.company} over LLM budget — refusing a realtime session`);
      return res.status(402).json({ error: "This workspace is over its AI budget", code: "OVER_BUDGET" });
    }
  } catch (err) {
    // Metering failure must not block an interview — fail open, exactly as aiUsable does.
    console.error("[voiceAgent] budget check failed, proceeding:", err.message);
  }

  const persona = await personaService.resolveForSession(session);
  await personaService.stampOnSession(session, persona);

  const payload = await voiceAgent.buildSession(session, { candidate, job: candidate.job, persona });
  // When the session opened, so its billable minutes can be closed out on disconnect.
  session.aiInterview.realtimeStartedAt = new Date();
  session.markModified("aiInterview.realtimeStartedAt");
  await session.save();
  res.json({ ...payload, persona: { name: persona.name, source: persona.source } });
}

// Close out a realtime session and meter what it cost.
//
// Realtime bills by SESSION-MINUTE, not by token, so none of it is visible to the per-call metering
// that covers every other model call in the system — the agent's reasoning goes Deepgram →
// OpenRouter and never passes through llmService at all. Without this the tenant's budget cap is
// bypassed by construction and the unit economics of a realtime interview are unreadable.
//
// Best-effort and idempotent: a candidate closing the tab must never fail, and a double-report
// must not double-bill.
async function realtimeEnd(req, res) {
  const session = req.interviewSession;
  const ai = session.aiInterview;
  const startedAt = ai?.realtimeStartedAt;
  if (!startedAt || ai?.realtimeMeteredAt) return res.json({ metered: false });

  const durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  ai.realtimeMeteredAt = new Date();
  ai.realtimeDurationMs = durationMs;
  session.markModified("aiInterview");
  await session.save();

  try {
    await usageService.recordUsage({
      company: session.company,
      session: session._id,
      candidate: session.candidate,
      kind: "realtime",
      provider: "deepgram",
      model: "voice-agent",
      usage: { costCents: voiceAgent.sessionCostCents(durationMs) },
      latencyMs: durationMs,
      engine: "ai",
    });
  } catch (err) {
    console.error("[voiceAgent] session metering failed:", err.message);
  }
  res.json({ metered: true, durationMs });
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

// What the BROWSER measured during the turn, sanitised. Mirrors the turn-based path's handling in
// interviewPortalController, and the trust model is the same: raw measurements are accepted (a
// client gains nothing by lying about them, and every derived SCORE is computed server-side), but
// every value is clamped so a bad one cannot land in the document.
//
// The transcript is the important field — it is the verbatim speech-to-text, and it displaces the
// agent's own rendering as the candidate's evidence. See voiceAgentService.submitAnswer.
const MAX_EVIDENCE_CHARS = 4000;

function sanitizeEvidence(e) {
  if (!e || typeof e !== "object") return {};
  const out = {
    transcript: String(e.transcript || "").slice(0, MAX_EVIDENCE_CHARS),
    audioDurationMs: clampNum(e.audioDurationMs, 0, 60 * 60 * 1000),
    confidence: clampNum(e.confidence, 0, 1),
  };
  if (e.acoustic && typeof e.acoustic === "object") {
    const a = {
      wordsPerMinute: clampNum(e.acoustic.wordsPerMinute, 0, 400),
      pauseRatio: clampNum(e.acoustic.pauseRatio, 0, 1),
      fillerRate: clampNum(e.acoustic.fillerRate, 0, 100),
      energyVariance: clampNum(e.acoustic.energyVariance, 0, 1e6),
    };
    if (Object.values(a).some((v) => v !== undefined)) out.acoustic = a;
  }
  // Only an interruption is worth recording. Claiming a question WAS interrupted can only make the
  // interview longer (its probe returns to pending), so there is no version of this a candidate
  // benefits from lying about.
  if (e.questionDelivery && e.questionDelivery.deliveredFully === false) {
    out.questionDelivery = {
      deliveredFully: false,
      interruptedAtChar: clampNum(e.questionDelivery.interruptedAtChar, 0, 100000),
    };
  }
  const drops = clampNum(e.connection?.drops, 0, 50);
  if (drops > 0) {
    out.connection = { drops, gapMs: clampNum(e.connection?.gapMs, 0, 60 * 60 * 1000) };
  }
  return out;
}

// Execute one function the agent asked for, and hand back the result it will speak from.
//
// The browser relays the request; it does not answer it. Every field that decides anything — which
// question comes next, whether a probe is covered, whether the interview may close — is re-derived
// from the InterviewSession here. The only thing taken from the agent is the candidate's answer
// text, which is the one thing only it heard.
async function realtimeFunction(req, res) {
  const session = req.interviewSession;
  const settings = await CompanySettings.findOne({ company: session.company }).select("ai compliance");
  if (!voiceAgent.isEnabled(settings)) {
    return res.status(404).json({ error: "Realtime voice interview is not enabled", code: "REALTIME_DISABLED" });
  }

  const name = String(req.body?.name || "").trim();
  const args = req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {};

  try {
    const result = await voiceAgent.dispatch(session, name, args, sanitizeEvidence(req.body?.evidence));
    res.json({ result });
  } catch (err) {
    // A thrown engine error must NOT become a dead conversation. The agent is mid-turn with a
    // candidate waiting, so it gets a speakable instruction back rather than an HTTP failure it
    // has no way to interpret — the interview continues and the failure is logged for us.
    console.error(`[voiceAgent] function "${name}" failed on session ${session._id}: ${err.message}`);
    res.json({
      result: {
        error: err.message,
        instruction:
          "Something went wrong on our side. Apologise briefly, tell the candidate you'll move on, " +
          "and call get_next_question to continue.",
      },
    });
  }
}

// Store what the agent actually said, in batches.
//
// This is the audit record that replaces exact-match speech authorization once the interviewer is
// allowed to improvise. It is what makes "what did the interviewer say to this candidate?"
// answerable — the question a discrimination claim turns on, and the one an unconstrained
// speech-to-speech competitor cannot answer at all.
async function realtimeTranscript(req, res) {
  const session = req.interviewSession;
  const incoming = Array.isArray(req.body?.utterances) ? req.body.utterances : [];

  const clean = [];
  for (const item of incoming) {
    if (clean.length >= MAX_UTTERANCES_PER_FLUSH) break;
    const text = String(item?.text || "").trim().slice(0, MAX_UTTERANCE_CHARS);
    if (!text) continue;
    // Only the AGENT's speech is stored here. The candidate's words are already recorded as turns
    // by the engine (submit_answer), and storing a second, differently-segmented copy would create
    // two records of what a candidate said that can disagree with each other.
    if (item?.role !== "assistant") continue;
    const at = Number(item?.at);
    clean.push({ text, at: Number.isFinite(at) ? new Date(at) : new Date() });
  }
  if (!clean.length) return res.json({ stored: 0 });

  const ai = session.aiInterview;
  ai.agentUtterances = [...(ai.agentUtterances || []), ...clean].slice(-MAX_AGENT_UTTERANCES);

  // ---- The guardrail ------------------------------------------------------
  //
  // Runs here, on the transcript, rather than anywhere near the audio path — so it adds nothing to
  // the latency the candidate feels. It is the enforcement half of the prompt's prevention: the
  // instructions tell the agent what it may not say, and this checks whether it said it, because
  // "we asked the model nicely" is not a control anyone can audit.
  const authorized = [...(ai.askedQuestions || [])];
  const found = [];
  let halt = null;
  for (const utterance of clean) {
    const { hits, severity } = guardrail.scan(utterance.text, { authorizedQuestions: authorized });
    if (!hits.length) continue;
    for (const hit of hits) {
      found.push({
        ruleId: hit.ruleId,
        severity: hit.severity,
        label: hit.label,
        matched: hit.matched,
        // The verbatim utterance, not a summary. "What exactly did the interviewer say to me?" is
        // the question a complaint turns on, and it cannot be answered from a rule name.
        utterance: utterance.text,
        at: utterance.at,
      });
    }
    if (guardrail.shouldHalt(severity) && !halt) halt = found[found.length - 1];
  }

  if (found.length) {
    ai.guardrailHits = [...(ai.guardrailHits || []), ...found].slice(-MAX_GUARDRAIL_HITS);
    session.markModified("aiInterview.guardrailHits");
    console.error(
      `[guardrail] ${found.length} finding(s) on session ${session._id}: ` +
        found.map((f) => `${f.ruleId}(${f.severity})`).join(", ")
    );
  }

  await session.save();

  if (halt) {
    // Stop the interview. NEVER adverse to the candidate: the interviewer went off-script, not
    // them. This routes to human review with the recommendation withheld, exactly like a
    // withdrawal — see aiInterviewService.reviewRequiredReason.
    try {
      await aiInterview.haltForGuardrail(session, halt);
    } catch (err) {
      console.error(`[guardrail] halt failed on session ${session._id}: ${err.message}`);
    }
    return res.json({
      stored: clean.length,
      halted: true,
      // The client disconnects and shows this. It does not repeat what the interviewer said —
      // reading an unlawful question back to the candidate to apologise for it is worse than the
      // original — and it does not imply anything about their performance.
      message: guardrail.HALT_MESSAGE,
    });
  }

  res.json({ stored: clean.length, findings: found.length });
}

module.exports = {
  realtimeAvailable,
  realtimeSession,
  realtimeFunction,
  realtimeTranscript,
  realtimeEnd,
  sanitizeEvidence,
  MAX_AGENT_UTTERANCES,
  MAX_UTTERANCES_PER_FLUSH,
};
