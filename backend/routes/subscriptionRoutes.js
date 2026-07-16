const express = require("express");
const { listPlans, getCompanySubscription } = require("../controllers/subscriptionController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/plans", listPlans);
router.get("/me", requireAuth, requireRole("admin"), getCompanySubscription);

module.exports = router;
