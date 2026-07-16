const express = require("express");
const {
  uploadResume,
  getResume,
  downloadResume,
  listResumeHistory,
} = require("../controllers/resumeController");
const resumeUpload = require("../middleware/resumeUpload");

const router = express.Router();

router.post("/", resumeUpload.single("resume"), uploadResume);
router.get("/history", listResumeHistory);
router.get("/:id", getResume);
router.get("/:id/download", downloadResume);

module.exports = router;
