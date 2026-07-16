const express = require("express");
const {
  getCandidate,
  updateCandidateStatus,
  downloadResume,
  getAtsResult,
  rerunAts,
} = require("../controllers/candidateController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin")];

router.get("/:id", requireAdmin, getCandidate);
router.get("/:id/resume", requireAdmin, downloadResume);
router.patch("/:id/status", requireAdmin, updateCandidateStatus);
router.get("/:id/ats", requireAdmin, getAtsResult);
router.post("/:id/ats/rerun", requireAdmin, rerunAts);

module.exports = router;
