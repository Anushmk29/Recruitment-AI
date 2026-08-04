const express = require("express");
const wrapRouter = require("../middleware/wrapRouter");
const {
  realtimeAvailable,
  realtimeSession,
  realtimeFunction,
  realtimeTranscript,
  realtimeEnd,
} = require("../controllers/voiceAgentController");
const { requireCandidateAuth } = require("../middleware/candidateAuth");
const { createLimiter, portalKey } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// The session endpoint hands out a short-lived Deepgram credential AND a Settings block carrying
// the OpenRouter key in `agent.think.endpoint.headers`. That makes it the most sensitive endpoint
// on the portal, so it is capped tightly — one session per interview plus reconnects, not a
// credential vending machine. A realtime session lasts the whole interview, unlike the turn-based
// token which is re-minted per answer, so the ceiling can be much lower than that path's 40/min.
const sessionLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 6,
  prefix: "rl:rt-session:",
  keyGenerator: portalKey,
  message: "Too many connection attempts — please wait a moment.",
});

// One call per question in the normal case, plus retries. Generous enough that a chatty agent
// re-checking the current question never stalls a live interview, bounded enough that a runaway
// function-calling loop cannot bill the tenant indefinitely.
const functionLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  prefix: "rl:rt-fn:",
  keyGenerator: portalKey,
});

// Transcript flushes. This endpoint is the guardrail's only input, so its rate limit is also the
// rate at which off-script speech can be caught — the client debounces to ~1s per spoken turn, and
// the ceiling has to comfortably exceed a chatty interviewer's turn rate. Being throttled here
// would mean an unapproved question going unchecked, which is the opposite of what a limit is for.
const transcriptLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 120,
  prefix: "rl:rt-tx:",
  keyGenerator: portalKey,
});

// Cheap and side-effect-free: the room asks this once, before it opens anything, so it knows which
// pipeline it is running. Mints nothing, so it shares the generous function limiter rather than the
// tight session one.
router.get("/available", requireCandidateAuth, functionLimiter, asyncHandler(realtimeAvailable));
router.post("/session", requireCandidateAuth, sessionLimiter, asyncHandler(realtimeSession));
router.post("/function", requireCandidateAuth, functionLimiter, asyncHandler(realtimeFunction));
router.post("/transcript", requireCandidateAuth, transcriptLimiter, asyncHandler(realtimeTranscript));
// Close out the billing window. Idempotent, and reachable on a tab close via sendBeacon, so the
// limit allows for retries — an unmetered session is worse than a duplicate request.
router.post("/end", requireCandidateAuth, sessionLimiter, asyncHandler(realtimeEnd));

module.exports = wrapRouter(router);
