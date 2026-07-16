const express = require("express");
const {
  login,
  me,
  speedTestFile,
  submitChecks,
  uploadIdentityPhoto,
  startInterview,
} = require("../controllers/interviewPortalController");
const { requireCandidateAuth } = require("../middleware/candidateAuth");
const identityPhotoUpload = require("../middleware/identityPhotoUpload");

const router = express.Router();

router.post("/login", login);
router.get("/me", requireCandidateAuth, me);
router.get("/speed-test-file", requireCandidateAuth, speedTestFile);
router.post("/checks", requireCandidateAuth, submitChecks);
router.post("/identity-verification", requireCandidateAuth, identityPhotoUpload.single("photo"), uploadIdentityPhoto);
router.post("/start", requireCandidateAuth, startInterview);

module.exports = router;
