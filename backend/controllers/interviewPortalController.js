const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fs = require("fs/promises");
const path = require("path");
const InterviewSession = require("../models/InterviewSession");
const { hashToken } = require("../services/interviewInvitationService");
const { detectImageType } = require("../utils/verifyFileSignature");

const IDENTITY_STORAGE_DIR = path.join(__dirname, "..", "uploads", "identity-photos");
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
  await fs.mkdir(IDENTITY_STORAGE_DIR, { recursive: true });
  const ext = imageType === "image/png" ? "png" : "jpg";
  const fileName = `${session._id}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const filePath = path.join(IDENTITY_STORAGE_DIR, fileName);
  await fs.writeFile(filePath, req.file.buffer);

  session.identityVerification = { photoPath: filePath, status: "captured", capturedAt: new Date() };
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

  session.status = "in_progress";
  session.startedAt = new Date();
  await session.save();

  res.json({ status: session.status, startedAt: session.startedAt });
}

module.exports = { login, me, speedTestFile, submitChecks, uploadIdentityPhoto, startInterview };
