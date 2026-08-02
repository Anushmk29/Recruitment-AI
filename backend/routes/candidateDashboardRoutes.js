const express = require("express");
const wrapRouter = require("../middleware/wrapRouter");
const {
  getDashboard,
  updateProfile,
  toggleSavedJob,
  openOwnSession,
  resendOwnSessionLink,
} = require("../controllers/candidateDashboardController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const requireCandidate = [requireAuth, requireRole("candidate")];

// Self-serve link recovery sends real email and rotates a session token, so it
// is bounded per account. The limit is generous enough for a genuine "I lost
// the mail, resend it" (a few tries across a couple of sessions) and far too
// tight to use this as a mail bomb aimed at the address on file.
const resendLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  prefix: "rl:cand-resend:",
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: "You've requested a few links already — please check your inbox and spam folder, then try again later.",
});

// Opening a session sends no mail and rotates no token — it only mints a
// short-lived portal JWT for a session the caller already owns. So the bound
// here is a brute-force ceiling, not a mail-bomb one: high enough that a
// candidate reopening the portal after a dropped connection (which is exactly
// when they retry most) is never locked out of their own interview.
const openLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 60,
  prefix: "rl:cand-open:",
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: "Too many attempts to open this session — please wait a moment and try again.",
});

router.get("/", requireCandidate, getDashboard);
router.patch("/profile", requireCandidate, updateProfile);
router.post("/saved-jobs/:jobId", requireCandidate, toggleSavedJob);
router.post("/sessions/:kind/:id/open", requireCandidate, openLimiter, openOwnSession);
router.post("/sessions/:kind/:id/resend", requireCandidate, resendLimiter, resendOwnSessionLink);

module.exports = wrapRouter(router);
