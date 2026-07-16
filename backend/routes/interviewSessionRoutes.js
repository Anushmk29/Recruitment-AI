const express = require("express");
const { verifyToken, getForCandidate } = require("../controllers/interviewSessionController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/verify/:token", verifyToken);
router.get("/candidate/:id", requireAuth, requireRole("admin"), getForCandidate);

module.exports = router;
