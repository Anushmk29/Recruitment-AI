const express = require("express");
const { getSettings, updateSettings } = require("../controllers/companySettingsController");
const { requireAuth, requireRole, requireActiveCompany } = require("../middleware/auth");

const router = express.Router();
const requireAdmin = [requireAuth, requireRole("admin"), requireActiveCompany];

router.get("/", requireAdmin, getSettings);
router.put("/", requireAdmin, updateSettings);

module.exports = router;
