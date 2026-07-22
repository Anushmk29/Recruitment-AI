const express = require("express");
const {
  createJob,
  listJobs,
  listPublishedJobs,
  getJob,
  updateJob,
  publishJob,
  deleteJob,
} = require("../controllers/jobController");
const { applyToJob, listCandidatesForJob } = require("../controllers/candidateController");
const upload = require("../middleware/upload");
const { requireAuth, optionalAuth, requireRole, requireActiveCompany } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin"), requireActiveCompany];
const requireCandidate = [requireAuth, requireRole("candidate")];

router.get("/published", listPublishedJobs);
router.post("/", requireAdmin, createJob);
router.get("/", requireAdmin, listJobs);
router.get("/:id", optionalAuth, getJob);
router.put("/:id", requireAdmin, updateJob);
router.patch("/:id/publish", requireAdmin, publishJob);
router.delete("/:id", requireAdmin, deleteJob);

router.post("/:id/apply", requireCandidate, upload.single("resume"), applyToJob);
router.get("/:id/candidates", requireAdmin, listCandidatesForJob);

module.exports = router;
