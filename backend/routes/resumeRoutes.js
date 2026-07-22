const express = require("express");
const {
  uploadResume,
  getResume,
  downloadResume,
  listResumeHistory,
} = require("../controllers/resumeController");
const resumeUpload = require("../middleware/resumeUpload");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// The resume library is the candidate-facing "My Resumes" feature. Every route
// is scoped to the authenticated candidate's own email inside the controller —
// resumes contain PII (name, phone, work history, full extracted text), so the
// account identity, never a client-supplied email/id, is the authorization key.
const requireCandidate = [requireAuth, requireRole("candidate")];

router.post("/", requireCandidate, resumeUpload.single("resume"), uploadResume);
router.get("/history", requireCandidate, listResumeHistory);
router.get("/:id", requireCandidate, getResume);
router.get("/:id/download", requireCandidate, downloadResume);

module.exports = router;
