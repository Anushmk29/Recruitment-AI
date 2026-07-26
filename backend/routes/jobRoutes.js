const express = require("express");
const wrapRouter = require("../middleware/wrapRouter");
const {
  createJob,
  listJobs,
  listPublishedJobs,
  getJob,
  updateJob,
  publishJob,
  deleteJob,
  listPublications,
  publishBoards,
  withdrawBoard,
} = require("../controllers/jobController");
const { applyToJob, listCandidatesForJob } = require("../controllers/candidateController");
const upload = require("../middleware/upload");
const { requireAuth, optionalAuth, requireRole, requireActiveCompany, requireActiveSubscription } = require("../middleware/auth");

const router = express.Router();
// requireActiveSubscription gates MUTATIONS only (Phase 11.2) — reads stay
// available to an expired tenant (read-only mode, never data lockout).
const requireAdmin = [requireAuth, requireRole("admin"), requireActiveCompany, requireActiveSubscription];
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

// Phase 15 — multi-board publishing (mutations gated on an active subscription).
router.get("/:id/publications", requireAuth, requireRole("admin"), requireActiveCompany, listPublications);
router.post("/:id/publish-boards", requireAdmin, publishBoards);
router.post("/:id/withdraw-board", requireAdmin, withdrawBoard);

module.exports = wrapRouter(router);
