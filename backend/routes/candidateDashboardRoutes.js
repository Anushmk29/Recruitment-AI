const express = require("express");
const wrapRouter = require("../middleware/wrapRouter");
const {
  getDashboard,
  updateProfile,
  toggleSavedJob,
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

router.get("/", requireCandidate, getDashboard);
router.patch("/profile", requireCandidate, updateProfile);
router.post("/saved-jobs/:jobId", requireCandidate, toggleSavedJob);
router.post("/sessions/:kind/:id/resend", requireCandidate, resendLimiter, resendOwnSessionLink);

module.exports = wrapRouter(router);
