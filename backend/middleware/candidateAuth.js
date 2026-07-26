const jwt = require("jsonwebtoken");
const InterviewSession = require("../models/InterviewSession");

// Shared session-state checks for both the laptop portal token and the phone
// companion token: the session must exist, belong to the token's candidate,
// and still be live.
async function loadSession(payload, res) {
  const session = await InterviewSession.findById(payload.sessionId);
  if (!session || String(session.candidate) !== payload.candidateId) {
    res.status(401).json({ error: "Interview session not found" });
    return null;
  }
  if (session.status === "cancelled") {
    res.status(410).json({ error: "This interview has been cancelled" });
    return null;
  }
  if (new Date() > session.expiresAt) {
    if (session.status !== "expired") {
      session.status = "expired";
      await session.save();
    }
    res.status(410).json({ error: "This interview link has expired" });
    return null;
  }
  return session;
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

async function requireCandidateAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Session expired or invalid, please use your interview link again" });
  }

  // Phase 14.6: phone-companion tokens carry an `aud` claim; the laptop portal
  // token never does. Rejecting any audience-bearing token here keeps the phone
  // token single-purpose — it can heartbeat and upload clips, never start the
  // interview or submit answers.
  if (payload.aud) {
    return res.status(401).json({ error: "This token is not valid for the interview portal" });
  }

  const session = await loadSession(payload, res);
  if (!session) return;

  req.interviewSession = session;
  next();
}

// Phone-companion auth (Phase 14.6). Accepts ONLY tokens minted for the
// "phone-cam" audience — the session token obtained by exchanging the short-TTL
// QR pairing token. Never accepted by requireCandidateAuth and vice versa.
async function requirePhoneAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { audience: "phone-cam" });
  } catch (err) {
    return res.status(401).json({ error: "Phone pairing expired or invalid — rescan the QR code" });
  }

  const session = await loadSession(payload, res);
  if (!session) return;

  req.interviewSession = session;
  next();
}

module.exports = { requireCandidateAuth, requirePhoneAuth };
