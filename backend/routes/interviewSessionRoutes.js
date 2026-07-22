const express = require("express");
const {
  verifyToken,
  getForCandidate,
  resendInterview,
  rescheduleInterview,
} = require("../controllers/interviewSessionController");
const { requireAuth, requireRole, requireActiveCompany } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin"), requireActiveCompany];

router.get("/verify/:token", verifyToken);
router.get("/candidate/:id", requireAdmin, getForCandidate);
router.post("/candidate/:id/resend", requireAdmin, resendInterview);
router.post("/candidate/:id/reschedule", requireAdmin, rescheduleInterview);

module.exports = router;
