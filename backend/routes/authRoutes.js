const express = require("express");
const {
  register,
  adminRegister,
  login,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  me,
} = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/register", register);
router.post("/admin/register", adminRegister);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", requireAuth, me);

module.exports = router;
