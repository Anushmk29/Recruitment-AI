const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const InterviewSession = require("../models/InterviewSession");
const storageService = require("../services/storageService");
const { hashToken } = require("../services/interviewInvitationService");
const { detectImageType } = require("../utils/verifyFileSignature");
const aiInterview = require("../services/aiInterviewService");
const speech = require("../services/speechService");
const proctoring = require("../utils/proctoring");

// Keep only a recent tail of raw events on the session (the per-type `counts` are the source of
// truth for the score); bound how many events one flush can carry to cap ingest cost.
const PROCTORING_EVENT_TAIL = 300;
const PROCTORING_MAX_PER_FLUSH = 100;

const SPEED_TEST_PAYLOAD = crypto.randomBytes(2 * 1024 * 1024); // 2MB, generated once at boot

function dashboardPayload(session, candidate, job) {
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
  res.json({ token: jwtToken, session: dashboardPayload(session, session.candidate, session.job) });
}

async function me(req, res) {
  const session = await InterviewSession.findById(req.interviewSession._id).populate("candidate").populate("job");
  res.json(dashboardPayload(session, session.candidate, session.job));
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
  if (!dc.screenShare) missing.push("screenShare");
  if (!dc.fullscreen) missing.push("fullscreen");
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
  res.json(state);
}

// Candidate consents to (or declines) proctoring before the interview. Recorded on the session so
// the recruiter can see it was obtained; declining is allowed and simply leaves vision off.
async function proctoringConsent(req, res) {
  const session = req.interviewSession;
  const given = !!req.body?.given;
  const p = session.proctoring || {};
  p.consent = { given, declined: !given, at: new Date() };
  if (typeof req.body?.visionEnabled === "boolean") p.visionEnabled = req.body.visionEnabled;
  session.proctoring = p;
  session.markModified("proctoring");
  await session.save();
  res.json({ consent: p.consent, visionEnabled: p.visionEnabled });
}

// Ingest a batch of integrity events streamed from the browser. The client sends only event TYPES
// (+ minimal meta); the server assigns severity, tallies per-type counts, and recomputes the risk
// score — never trusting a client-supplied severity or score. Optional `identityMatch` carries the
// in-browser face-match result; a mismatch is counted as an identity_mismatch event server-side.
async function proctoringEvents(req, res) {
  const session = req.interviewSession;
  const incoming = Array.isArray(req.body?.events) ? req.body.events.slice(0, PROCTORING_MAX_PER_FLUSH) : [];

  const p = session.proctoring || {};
  if (typeof req.body?.visionEnabled === "boolean") p.visionEnabled = req.body.visionEnabled;
  const counts = { ...(p.counts || {}) };
  const accepted = [];

  for (const raw of incoming) {
    const type = String(raw?.type || "");
    if (!proctoring.isKnownType(type)) continue;
    counts[type] = (counts[type] || 0) + 1;
    accepted.push({ type, severity: proctoring.severityOf(type), meta: proctoring.sanitizeMeta(type, raw?.meta), at: new Date() });
  }

  // Identity match is reported at most once; the server derives the risk hit (don't trust the
  // client to also send the penalty event).
  const im = req.body?.identityMatch;
  if (im && typeof im === "object" && typeof im.matched === "boolean") {
    const distance = Number.isFinite(Number(im.distance)) ? Math.round(Number(im.distance) * 1000) / 1000 : undefined;
    const prev = p.identityMatch?.status;
    p.identityMatch = { status: im.matched ? "match" : "mismatch", distance, checkedAt: new Date() };
    if (!im.matched && prev !== "mismatch") {
      counts.identity_mismatch = (counts.identity_mismatch || 0) + 1;
      accepted.push({ type: "identity_mismatch", severity: "high", meta: distance != null ? { distance } : undefined, at: new Date() });
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

  res.json({ riskScore, riskBand, accepted: accepted.length });
}

// Mint a short-lived streaming credential for the browser's real-time voice pipeline. The
// candidate's session must be live (requireCandidateAuth already enforced link validity).
async function voiceToken(req, res) {
  if (!speech.isEnabled()) {
    return res.status(503).json({ error: "Voice interview is not configured", code: "VOICE_DISABLED" });
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
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", audio.length);
  res.setHeader("Cache-Control", "no-store");
  res.send(audio);
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
  voiceToken,
  voiceSpeak,
};
