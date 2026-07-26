const express = require("express");
const wrapRouter = require("../middleware/wrapRouter");
const {
  verifyToken,
  getForCandidate,
  resendInterview,
  rescheduleInterview,
  listEvidence,
  streamEvidenceClip,
} = require("../controllers/interviewSessionController");
const { requireAuth, requireRole, requireActiveCompany } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin"), requireActiveCompany];

router.get("/verify/:token", verifyToken);
router.get("/candidate/:id", requireAdmin, getForCandidate);
router.post("/candidate/:id/resend", requireAdmin, resendInterview);
router.post("/candidate/:id/reschedule", requireAdmin, rescheduleInterview);
// Phase 14.5 — evidence-clip review; every clip view writes an AuditLog row.
router.get("/candidate/:id/evidence", requireAdmin, listEvidence);
router.get("/evidence/:evidenceId", requireAdmin, streamEvidenceClip);

module.exports = wrapRouter(router);
