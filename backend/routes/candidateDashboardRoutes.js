const express = require("express");
const wrapRouter = require("../middleware/wrapRouter");
const { getDashboard, updateProfile, toggleSavedJob } = require("../controllers/candidateDashboardController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const requireCandidate = [requireAuth, requireRole("candidate")];

router.get("/", requireCandidate, getDashboard);
router.patch("/profile", requireCandidate, updateProfile);
router.post("/saved-jobs/:jobId", requireCandidate, toggleSavedJob);

module.exports = wrapRouter(router);
