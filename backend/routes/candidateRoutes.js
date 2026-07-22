const express = require("express");
const {
  getCandidate,
  moveStage,
  getTimeline,
  exportCandidate,
  downloadResume,
  getAtsResult,
  rerunAts,
  getInterviewReport,
  getInterviewReportPdf,
} = require("../controllers/candidateController");
const { requireAuth, requireRole, requireActiveCompany } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin"), requireActiveCompany];

router.get("/:id", requireAdmin, getCandidate);
router.get("/:id/resume", requireAdmin, downloadResume);
router.get("/:id/timeline", requireAdmin, getTimeline);
router.get("/:id/export", requireAdmin, exportCandidate);
router.patch("/:id/status", requireAdmin, moveStage); // legacy body { status }
router.patch("/:id/stage", requireAdmin, moveStage); // preferred body { stage, note, offerMessage }
router.get("/:id/ats", requireAdmin, getAtsResult);
router.post("/:id/ats/rerun", requireAdmin, rerunAts);
router.get("/:id/interview-report", requireAdmin, getInterviewReport);
router.get("/:id/interview-report/pdf", requireAdmin, getInterviewReportPdf);

module.exports = router;
