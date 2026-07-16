const express = require("express");
const { listQueue, updateQueueEntry } = require("../controllers/interviewQueueController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin")];

router.get("/", requireAdmin, listQueue);
router.patch("/:id", requireAdmin, updateQueueEntry);

module.exports = router;
