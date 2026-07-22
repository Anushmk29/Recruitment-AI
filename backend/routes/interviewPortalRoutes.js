const express = require("express");
const {
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
} = require("../controllers/interviewPortalController");
const { requireCandidateAuth } = require("../middleware/candidateAuth");
const identityPhotoUpload = require("../middleware/identityPhotoUpload");
const { createLimiter, portalKey } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// Each answer = one LLM call; the speed-test ships a 2 MB payload. Bound both per
// candidate so a valid token can't be used to amplify cost.
const answerLimiter = createLimiter({ windowMs: 60 * 1000, max: 20, prefix: "rl:answer:", keyGenerator: portalKey, message: "You're answering too quickly — please wait a moment." });
const speedTestLimiter = createLimiter({ windowMs: 60 * 1000, max: 10, prefix: "rl:speedtest:", keyGenerator: portalKey });
const loginLimiter = createLimiter({ windowMs: 60 * 1000, max: 20, prefix: "rl:portal-login:" });
// Streaming tokens are short-lived (~60s) and re-minted per answer/reconnect; allow enough for
// a multi-question interview + reconnects, but cap to prevent a valid session amplifying cost.
const voiceTokenLimiter = createLimiter({ windowMs: 60 * 1000, max: 40, prefix: "rl:voice-token:", keyGenerator: portalKey });
const voiceSpeakLimiter = createLimiter({ windowMs: 60 * 1000, max: 60, prefix: "rl:voice-speak:", keyGenerator: portalKey });
// Proctoring events are flushed in batches (~every few seconds); allow a generous rate for a
// long interview + reconnects, but still cap so a token can't be used to hammer the endpoint.
const proctoringLimiter = createLimiter({ windowMs: 60 * 1000, max: 60, prefix: "rl:proctoring:", keyGenerator: portalKey });

router.post("/login", loginLimiter, asyncHandler(login));
router.get("/me", requireCandidateAuth, asyncHandler(me));
router.get("/speed-test-file", requireCandidateAuth, speedTestLimiter, asyncHandler(speedTestFile));
router.post("/checks", requireCandidateAuth, asyncHandler(submitChecks));
router.post("/identity-verification", requireCandidateAuth, identityPhotoUpload.single("photo"), asyncHandler(uploadIdentityPhoto));
router.post("/start", requireCandidateAuth, asyncHandler(startInterview));
router.get("/interview", requireCandidateAuth, asyncHandler(getInterviewState));
router.post("/interview/answer", requireCandidateAuth, answerLimiter, asyncHandler(submitAnswer));
router.post("/proctoring/consent", requireCandidateAuth, proctoringLimiter, asyncHandler(proctoringConsent));
router.post("/proctoring/events", requireCandidateAuth, proctoringLimiter, asyncHandler(proctoringEvents));
router.get("/voice/token", requireCandidateAuth, voiceTokenLimiter, asyncHandler(voiceToken));
router.post("/voice/speak", requireCandidateAuth, voiceSpeakLimiter, asyncHandler(voiceSpeak));

module.exports = router;
