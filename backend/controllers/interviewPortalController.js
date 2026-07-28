const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const InterviewSession = require("../models/InterviewSession");
const storageService = require("../services/storageService");
const { hashToken } = require("../services/interviewInvitationService");
const { detectImageType } = require("../utils/verifyFileSignature");
const aiInterview = require("../services/aiInterviewService");
const speech = require("../services/speechService");
const proctoring = require("../utils/proctoring");
const evidenceClipService = require("../services/evidenceClipService");
const CompanySettings = require("../models/CompanySettings");
const { candidateLinkBase } = require("../utils/corsOrigins");

// Keep only a recent tail of raw events on the session (the per-type `counts` are the source of
// truth for the score); bound how many events one flush can carry to cap ingest cost.
const PROCTORING_EVENT_TAIL = 300;
const PROCTORING_MAX_PER_FLUSH = 100;

// Phase 14.6 — the phone companion heartbeats every ~10s; past this silence the
// laptop's next event flush raises phone_cam_lost (once per outage).
const PHONE_HEARTBEAT_TIMEOUT_MS = Number(process.env.PHONE_HEARTBEAT_TIMEOUT_MS) || 12000;
// The QR pairing token is single-purpose and short-lived: long enough to pull
// out a phone and scan, useless if the QR leaks later.
const PHONE_PAIR_TOKEN_TTL = "10m";

const SPEED_TEST_PAYLOAD = crypto.randomBytes(2 * 1024 * 1024); // 2MB, generated once at boot

function dashboardPayload(session, candidate, job, settings) {
  return {
    candidateName: candidate.basicDetails.name,
    jobTitle: job.title,
    department: job.department,
    interviewAt: session.interviewAt,
    expiresAt: session.expiresAt,
    status: session.status,
    instructions: session.instructions,
    startedAt: session.startedAt,
    deviceCheck: session.deviceCheck,
    speedTest: session.speedTest,
    identityVerification: session.identityVerification,
    // Phase 14 — tell the client which integrity features this tenant runs, so
    // the consent wording and the pairing QR only appear when they apply.
    features: {
      evidenceClips: evidenceClipService.clipsEnabled(settings),
      secondaryCam: evidenceClipService.secondaryCamEnabled(settings),
    },
  };
}

function signSession(session) {
  const expiresInSeconds = Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  // session.candidate may be a populated Candidate doc or a raw ObjectId
  // depending on the caller — normalize to the id string either way.
  const candidateId = session.candidate._id ? String(session.candidate._id) : String(session.candidate);

  return jwt.sign(
    { candidateId, sessionId: String(session._id) },
    process.env.JWT_SECRET,
    { expiresIn: expiresInSeconds }
  );
}

async function login(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  const session = await InterviewSession.findOne({ tokenHash: hashToken(token) })
    .populate("candidate")
    .populate("job");
  if (!session) return res.status(404).json({ error: "Invalid interview link" });
  if (session.status === "cancelled") return res.status(410).json({ error: "This interview has been cancelled" });
  if (new Date() > session.expiresAt) {
    if (session.status !== "expired") {
      session.status = "expired";
      await session.save();
    }
    return res.status(410).json({ error: "This interview link has expired" });
  }

  if (!session.accessedAt) {
    session.accessedAt = new Date();
    await session.save();
  }

  const jwtToken = signSession(session);
  const settings = await CompanySettings.findOne({ company: session.company }).select("proctoring");
  res.json({ token: jwtToken, session: dashboardPayload(session, session.candidate, session.job, settings) });
}

async function me(req, res) {
  const session = await InterviewSession.findById(req.interviewSession._id).populate("candidate").populate("job");
  const settings = await CompanySettings.findOne({ company: session.company }).select("proctoring");
  res.json(dashboardPayload(session, session.candidate, session.job, settings));
}

function speedTestFile(req, res) {
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Length": SPEED_TEST_PAYLOAD.length,
    "Cache-Control": "no-store",
  });
  res.send(SPEED_TEST_PAYLOAD);
}

async function submitChecks(req, res) {
  const { camera, microphone, screenShare, fullscreen, deviceCompatible, browserInfo, downloadMbps } = req.body;
  const session = req.interviewSession;

  session.deviceCheck = {
    camera: !!camera,
    microphone: !!microphone,
    screenShare: !!screenShare,
    fullscreen: !!fullscreen,
    deviceCompatible: !!deviceCompatible,
    browserInfo,
    completedAt: new Date(),
  };
  if (typeof downloadMbps === "number") {
    session.speedTest = { downloadMbps, testedAt: new Date() };
  }

  await session.save();
  res.json({ deviceCheck: session.deviceCheck, speedTest: session.speedTest });
}

async function uploadIdentityPhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: "photo is required" });

  const imageType = detectImageType(req.file.buffer);
  if (!imageType) {
    return res.status(400).json({ error: "File content does not match a valid JPEG or PNG image" });
  }

  const session = req.interviewSession;
  const ext = imageType === "image/png" ? "png" : "jpg";
  const key = await storageService.putObject({
    buffer: req.file.buffer,
    key: storageService.buildKey("identity-photos", {
      company: session.company,
      prefix: String(session._id),
      originalName: `photo.${ext}`,
    }),
    contentType: imageType,
  });

  session.identityVerification = { photoPath: key, status: "captured", capturedAt: new Date() };
  await session.save();

  res.json({ identityVerification: session.identityVerification });
}

function missingChecks(session) {
  const missing = [];
  const dc = session.deviceCheck || {};
  if (!dc.camera) missing.push("camera");
  if (!dc.microphone) missing.push("microphone");
  // screenShare and fullscreen are deliberately NOT required. The screen-share
  // "check" was theater — the stream was stopped immediately and the screen was
  // never captured during the interview — and getDisplayMedia doesn't exist on
  // mobile browsers, so requiring it silently hard-blocked every mobile
  // candidate. Fullscreen is best-effort: proctoring already flags exits.
  if (!dc.deviceCompatible) missing.push("deviceCompatible");
  if (!session.speedTest || typeof session.speedTest.downloadMbps !== "number") missing.push("speedTest");
  if (!session.identityVerification || session.identityVerification.status !== "captured") {
    missing.push("identityVerification");
  }
  return missing;
}

async function startInterview(req, res) {
  const session = req.interviewSession;
  const missing = missingChecks(session);
  if (missing.length > 0) {
    return res.status(400).json({ error: "Pre-interview checks incomplete", missing });
  }

  // Plan quota (Phase 11.1): AI interviews are blocked at the START only — an
  // interview that already began is NEVER killed mid-flight by a limit.
  if (session.aiInterview?.status === "not_started") {
    await require("../services/quotaService").enforce(session.company, "aiInterviews");
  }

  if (session.status === "scheduled") {
    session.status = "in_progress";
    session.startedAt = new Date();
    await session.save();
  }

  // Kick off the AI interview (loads context, builds a plan, asks the first
  // question). Idempotent — a resumed session just returns its current state.
  const state = await aiInterview.beginInterview(session);
  res.json({ status: session.status, startedAt: session.startedAt, interview: state });
}

// Current interview state for the candidate (transcript + current question).
async function getInterviewState(req, res) {
  const session = req.interviewSession;
  if (session.aiInterview?.status === "not_started") {
    return res.json(aiInterview.publicState(session));
  }
  res.json(aiInterview.publicState(session));
}

// Clamp a client-supplied number into a sane range (or undefined). The browser computes raw
// prosody measurements during recording; we store the measurements but never trust a
// client-supplied *score* — the delivery/confidence score is derived server-side (V3).
function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

function sanitizeAcoustic(a) {
  if (!a || typeof a !== "object") return undefined;
  const out = {
    wordsPerMinute: clampNum(a.wordsPerMinute, 0, 400),
    pauseRatio: clampNum(a.pauseRatio, 0, 1),
    fillerRate: clampNum(a.fillerRate, 0, 100),
    pitchVariance: clampNum(a.pitchVariance, 0, 1e6),
    energyVariance: clampNum(a.energyVariance, 0, 1e6),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

// Candidate submits an answer (typed OR the transcript of a spoken answer, with optional voice
// metadata). Returns the next question or completion.
async function submitAnswer(req, res) {
  const session = req.interviewSession;
  const b = req.body || {};
  const opts = {
    inputMode: b.inputMode === "voice" ? "voice" : "text",
    transcriptConfidence: clampNum(b.transcriptConfidence, 0, 1),
    audioDurationMs: clampNum(b.audioDurationMs, 0, 60 * 60 * 1000),
    acoustic: sanitizeAcoustic(b.acoustic),
  };
  const state = await aiInterview.submitAnswer(session, b.text, opts);

  // Phase 9.4 — meter voice STT spend per spoken answer (the only point where
  // the audio duration is known). Best-effort: metering never blocks an answer.
  if (opts.inputMode === "voice" && opts.audioDurationMs > 0) {
    const usageService = require("../services/usageService");
    await usageService.recordUsage({
      company: session.company,
      session: session._id,
      candidate: session.candidate,
      kind: "stt",
      provider: speech.provider(),
      model: speech.models().sttModel,
      usage: { costCents: speech.sttCostCents(opts.audioDurationMs) },
      latencyMs: opts.audioDurationMs,
      engine: "ai",
    });
  }
  res.json(state);
}

// Candidate consents to (or declines) VOICE capture before the microphone ever
// opens (Phase 9.5) — mirrors the proctoring consent gate. Declining is fine:
// the typed-answer path is always available and never penalised.
async function voiceConsent(req, res) {
  const session = req.interviewSession;
  const given = !!req.body?.given;
  session.voiceConsent = { given, declined: !given, at: new Date() };
  await session.save();
  res.json({ voiceConsent: session.voiceConsent });
}

// Candidate consents to (or declines) proctoring before the interview. Recorded on the session so
// the recruiter can see it was obtained; declining is allowed and simply leaves vision off.
async function proctoringConsent(req, res) {
  const session = req.interviewSession;
  const given = !!req.body?.given;
  const p = session.proctoring || {};
  p.consent = { given, declined: !given, at: new Date() };
  if (typeof req.body?.visionEnabled === "boolean") p.visionEnabled = req.body.visionEnabled;

  // Phase 14.3 — the clip-capture clause is consented (or declined) explicitly,
  // and a decline is RECORDED, not merely inferred from absence. The accepted
  // wording version is stored with the decision.
  if (req.body?.evidence && typeof req.body.evidence.given === "boolean") {
    p.evidenceConsent = {
      given: req.body.evidence.given,
      declined: !req.body.evidence.given,
      at: new Date(),
      wordingVersion: String(req.body.evidence.wordingVersion || "2026-07-25.1").slice(0, 40),
    };
  }

  session.proctoring = p;
  session.markModified("proctoring");
  await session.save();
  res.json({ consent: p.consent, evidenceConsent: p.evidenceConsent || null, visionEnabled: p.visionEnabled });
}

// Ingest a batch of integrity events streamed from the browser. The client sends only event TYPES
// (+ minimal meta); the server assigns severity, tallies per-type counts, and recomputes the risk
// score — never trusting a client-supplied severity or score. Optional `identityMatch` carries the
// in-browser face-match result; a mismatch is counted as an identity_mismatch event server-side.
// Shared tally: events stream in from the laptop AND (Phase 14.6) the phone
// companion; both land in the same per-type counts and the same risk model.
// `checkPhone` runs only on the laptop flush — it turns phone-heartbeat
// staleness into a phone_cam_lost event exactly once per outage.
async function ingestProctoringEvents(session, body, { checkPhone = false } = {}) {
  const incoming = Array.isArray(body?.events) ? body.events.slice(0, PROCTORING_MAX_PER_FLUSH) : [];

  const p = session.proctoring || {};
  if (typeof body?.visionEnabled === "boolean") p.visionEnabled = body.visionEnabled;
  const counts = { ...(p.counts || {}) };
  const accepted = [];

  for (const raw of incoming) {
    const type = String(raw?.type || "");
    if (!proctoring.isKnownType(type)) continue;
    // phone_cam_lost is derived server-side from heartbeat staleness — a client
    // can't inject it directly.
    if (type === "phone_cam_lost") continue;
    counts[type] = (counts[type] || 0) + 1;
    accepted.push({ type, severity: proctoring.severityOf(type), meta: proctoring.sanitizeMeta(type, raw?.meta), at: new Date() });
  }

  // Identity match is reported at most once; the server derives the risk hit (don't trust the
  // client to also send the penalty event).
  const im = body?.identityMatch;
  if (im && typeof im === "object" && typeof im.matched === "boolean") {
    const distance = Number.isFinite(Number(im.distance)) ? Math.round(Number(im.distance) * 1000) / 1000 : undefined;
    const prev = p.identityMatch?.status;
    p.identityMatch = { status: im.matched ? "match" : "mismatch", distance, checkedAt: new Date() };
    if (!im.matched && prev !== "mismatch") {
      counts.identity_mismatch = (counts.identity_mismatch || 0) + 1;
      accepted.push({ type: "identity_mismatch", severity: "high", meta: distance != null ? { distance } : undefined, at: new Date() });
    }
  }

  if (checkPhone) {
    const pc = p.phoneCam;
    const stale =
      pc?.paired &&
      pc.lastHeartbeatAt &&
      Date.now() - new Date(pc.lastHeartbeatAt).getTime() > PHONE_HEARTBEAT_TIMEOUT_MS;
    if (stale && !pc.lostFlagged) {
      counts.phone_cam_lost = (counts.phone_cam_lost || 0) + 1;
      accepted.push({ type: "phone_cam_lost", severity: proctoring.severityOf("phone_cam_lost"), at: new Date() });
      pc.lostFlagged = true;
    }
  }

  const { riskScore, riskBand } = proctoring.computeRisk(counts);
  p.counts = counts;
  p.totalEvents = (p.totalEvents || 0) + accepted.length;
  p.riskScore = riskScore;
  p.riskBand = riskBand;
  if (accepted.length) {
    p.lastEventAt = new Date();
    p.events = [...(p.events || []), ...accepted].slice(-PROCTORING_EVENT_TAIL);
  }
  session.proctoring = p;
  session.markModified("proctoring");
  await session.save();

  return { riskScore, riskBand, accepted: accepted.length };
}

async function proctoringEvents(req, res) {
  const result = await ingestProctoringEvents(req.interviewSession, req.body, { checkPhone: true });
  res.json(result);
}

// Mint a short-lived streaming credential for the browser's real-time voice pipeline. The
// candidate's session must be live (requireCandidateAuth already enforced link validity).
async function voiceToken(req, res) {
  if (!speech.isEnabled()) {
    return res.status(503).json({ error: "Voice interview is not configured", code: "VOICE_DISABLED" });
  }
  // Hard server-side gate (Phase 9.5): no voice consent ⇒ no streaming
  // credential ⇒ the mic can never open. The UI collects consent; this enforces it.
  if (!req.interviewSession?.voiceConsent?.given) {
    return res.status(403).json({ error: "Voice consent has not been given for this interview", code: "VOICE_CONSENT_REQUIRED" });
  }
  const cred = await speech.grantStreamingToken();
  res.json(cred);
}

// Text-to-speech proxy for spoken questions — the browser posts the question text and gets back
// MP3 audio. Server-side so the Deepgram key never reaches the client.
async function voiceSpeak(req, res) {
  if (!speech.isEnabled()) {
    return res.status(503).json({ error: "Voice interview is not configured", code: "VOICE_DISABLED" });
  }
  const { audio, contentType } = await speech.synthesize(req.body?.text);

  // Phase 9.4 — meter TTS spend (characters synthesized). Best-effort.
  const session = req.interviewSession;
  const chars = String(req.body?.text || "").trim().slice(0, 2000).length;
  const usageService = require("../services/usageService");
  await usageService.recordUsage({
    company: session.company,
    session: session._id,
    candidate: session.candidate,
    kind: "tts",
    provider: speech.provider(),
    model: speech.models().ttsModel,
    usage: { costCents: speech.ttsCostCents(chars) },
    engine: "ai",
  });

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", audio.length);
  res.setHeader("Cache-Control", "no-store");
  res.send(audio);
}

// ---------------------------------------------------------------------------
// Phase 14 — event-anchored evidence clips + phone companion camera
// ---------------------------------------------------------------------------

// Shared by the laptop route and the phone route (source differs). The service
// owns every policy check: consent, qualifying event, magic bytes, size, and
// the SERVER-side per-session cap.
async function uploadEvidenceClip(req, res) {
  const session = req.interviewSession;
  const settings = await CompanySettings.findOne({ company: session.company }).select("proctoring");
  if (!evidenceClipService.clipsEnabled(settings)) {
    return res.status(403).json({ error: "Evidence clips are not enabled for this interview", code: "EVIDENCE_DISABLED" });
  }
  if (!req.file?.buffer) return res.status(400).json({ error: "clip file is required" });

  try {
    const row = await evidenceClipService.storeClip({
      session,
      eventType: req.body?.eventType,
      source: req.evidenceSource === "phone" ? "phone" : "laptop",
      buffer: req.file.buffer,
      durationMs: req.body?.durationMs,
    });
    res.status(201).json({ id: row._id, eventType: row.eventType, capturedAt: row.capturedAt });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    throw err;
  }
}

function phoneEvidenceClip(req, res) {
  req.evidenceSource = "phone";
  return uploadEvidenceClip(req, res);
}

// GET /interview-portal/phone/pair — laptop asks for a QR payload. The token is
// aud-scoped ("phone-pair"), single-purpose, 10-minute TTL, and useless against
// any portal endpoint (requireCandidateAuth rejects audience-bearing tokens).
async function phonePair(req, res) {
  const session = req.interviewSession;
  const settings = await CompanySettings.findOne({ company: session.company }).select("proctoring");
  if (!evidenceClipService.secondaryCamEnabled(settings)) {
    return res.status(403).json({ error: "Secondary camera is not enabled for this interview", code: "SECONDARY_CAM_DISABLED" });
  }

  const candidateId = session.candidate._id ? String(session.candidate._id) : String(session.candidate);
  const token = jwt.sign(
    { candidateId, sessionId: String(session._id) },
    process.env.JWT_SECRET,
    { audience: "phone-pair", expiresIn: PHONE_PAIR_TOKEN_TTL }
  );
  // candidateLinkBase: the address actually meant to be scanned/shared —
  // PUBLIC_CANDIDATE_URL when set, else the first CLIENT_ORIGIN_USER origin.
  res.json({ token, url: `${candidateLinkBase()}/phone-cam/${token}` });
}

// POST /interview-portal/phone/login — the phone exchanges the scanned pairing
// token for a phone-session token (aud "phone-cam") that lives as long as the
// interview session. Mirrors the magic-link → session pattern.
async function phoneLogin(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "token is required" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { audience: "phone-pair" });
  } catch (err) {
    return res.status(401).json({ error: "Pairing code expired or invalid — generate a new QR on the laptop" });
  }

  const session = await InterviewSession.findById(payload.sessionId);
  if (!session || String(session.candidate) !== payload.candidateId) {
    return res.status(404).json({ error: "Interview session not found" });
  }
  if (session.status === "cancelled" || new Date() > session.expiresAt) {
    return res.status(410).json({ error: "This interview is no longer active" });
  }

  const expiresInSeconds = Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  const phoneToken = jwt.sign(
    { candidateId: payload.candidateId, sessionId: String(session._id) },
    process.env.JWT_SECRET,
    { audience: "phone-cam", expiresIn: expiresInSeconds }
  );

  const p = session.proctoring || {};
  p.phoneCam = { ...(p.phoneCam || {}), paired: true, pairedAt: new Date(), lastHeartbeatAt: new Date(), lostFlagged: false };
  session.proctoring = p;
  session.markModified("proctoring");
  await session.save();

  res.json({ token: phoneToken, expiresAt: session.expiresAt });
}

// POST /interview-portal/phone/heartbeat — presence signal, nothing more. A
// resumed heartbeat after an outage re-arms the loss detector.
async function phoneHeartbeat(req, res) {
  const session = req.interviewSession;
  const p = session.proctoring || {};
  p.phoneCam = { ...(p.phoneCam || {}), paired: true, lastHeartbeatAt: new Date(), lostFlagged: false };
  session.proctoring = p;
  session.markModified("proctoring");
  await session.save();
  res.json({ ok: true });
}

// POST /interview-portal/phone/events — phone-side vision events (multi_face
// etc.) land in the same counts and risk model as laptop events.
async function phoneEvents(req, res) {
  const result = await ingestProctoringEvents(req.interviewSession, req.body, { checkPhone: false });
  res.json(result);
}

module.exports = {
  login,
  me,
  speedTestFile,
  submitChecks,
  uploadIdentityPhoto,
  startInterview,
  getInterviewState,
  submitAnswer,
  proctoringConsent,
  proctoringEvents,
  voiceConsent,
  voiceToken,
  voiceSpeak,
  uploadEvidenceClip,
  phoneEvidenceClip,
  phonePair,
  phoneLogin,
  phoneHeartbeat,
  phoneEvents,
};
