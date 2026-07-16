const jwt = require("jsonwebtoken");
const InterviewSession = require("../models/InterviewSession");

async function requireCandidateAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Session expired or invalid, please use your interview link again" });
  }

  const session = await InterviewSession.findById(payload.sessionId);
  if (!session || String(session.candidate) !== payload.candidateId) {
    return res.status(401).json({ error: "Interview session not found" });
  }
  if (session.status === "cancelled") {
    return res.status(410).json({ error: "This interview has been cancelled" });
  }
  if (new Date() > session.expiresAt) {
    if (session.status !== "expired") {
      session.status = "expired";
      await session.save();
    }
    return res.status(410).json({ error: "This interview link has expired" });
  }

  req.interviewSession = session;
  next();
}

module.exports = { requireCandidateAuth };
