const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Company = require("../models/Company");
const { hashPassword, comparePassword } = require("../utils/passwords");
const { hashToken, generateVerificationToken, generateResetToken } = require("../utils/authTokens");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../utils/mailer");
const { isStrongPassword, isValidPhone } = require("../utils/validators");
const { initializeDashboard } = require("./candidateDashboardController");
const { notifyAdmin, notifyCandidate } = require("../services/notificationService");
const { dispatchEmail } = require("../services/emailDispatchService");
const { passwordChangedEmailTemplate } = require("../utils/emailTemplates");

const JWT_EXPIRES_IN = "7d";
const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character";

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified,
    company: user.company || null,
  };
}

function signUser(user) {
  return jwt.sign({ userId: String(user._id), role: user.role }, process.env.AUTH_JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function originForRole(role) {
  return role === "admin" || role === "superadmin"
    ? process.env.CLIENT_ORIGIN_ADMIN || "http://localhost:5173"
    : process.env.CLIENT_ORIGIN_USER || "http://localhost:5174";
}

async function sendVerificationForUser(user) {
  const { token, tokenHash, expiresAt } = generateVerificationToken();
  user.verificationTokenHash = tokenHash;
  user.verificationExpiresAt = expiresAt;
  await user.save();

  const verifyUrl = `${originForRole(user.role)}/verify-email/${token}`;
  try {
    await sendVerificationEmail(user, verifyUrl);
  } catch (err) {
    console.error("Failed to send verification email:", err.message);
  }
}

async function register(req, res) {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: "name, email, phone, and password are required" });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Please provide a valid phone number" });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: STRONG_PASSWORD_MESSAGE });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: phone.trim(),
    passwordHash,
    role: "candidate",
  });

  await sendVerificationForUser(user);

  res.status(201).json({
    message: "Account created. Please check your email to verify your address before logging in.",
    user: sanitizeUser(user),
  });
}

// Bootstraps a platform superadmin (not tied to any company). Company-scoped
// admin accounts are created automatically via the company registration +
// subscription flow (see companyAuthController), not through this endpoint.
async function adminRegister(req, res) {
  const signupKey = req.headers["x-admin-signup-key"];
  if (!signupKey || signupKey !== process.env.ADMIN_SIGNUP_KEY) {
    return res.status(403).json({ error: "Invalid admin signup key" });
  }

  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: STRONG_PASSWORD_MESSAGE });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: "superadmin",
  });

  await sendVerificationForUser(user);

  res.status(201).json({
    message: "Superadmin account created. Please check your email to verify your address before logging in.",
    user: sanitizeUser(user),
  });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (!user.emailVerified) {
    return res.status(403).json({ error: "Please verify your email before logging in", code: "EMAIL_NOT_VERIFIED" });
  }

  if (user.role === "admin" && user.company) {
    const company = await Company.findById(user.company);
    if (!company || company.status === "pending_payment") {
      // Authentication itself succeeded — only full product access is gated.
      // Issue a token anyway so the frontend can carry the admin straight to
      // checkout instead of leaving them stuck if they closed the browser
      // mid-onboarding.
      return res.status(403).json({
        error: "Please complete your subscription payment to activate your workspace",
        code: "PAYMENT_REQUIRED",
        token: signUser(user),
        user: sanitizeUser(user),
      });
    }
    if (company.status === "suspended") {
      return res.status(403).json({
        error: "Your company workspace has been suspended. Please contact support.",
        code: "COMPANY_SUSPENDED",
      });
    }
  }

  const token = signUser(user);
  res.json({ token, user: sanitizeUser(user) });
}

async function verifyEmail(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  const user = await User.findOne({ verificationTokenHash: hashToken(token) });
  if (!user || !user.verificationExpiresAt || new Date() > user.verificationExpiresAt) {
    return res.status(400).json({ error: "This verification link is invalid or has expired" });
  }

  user.emailVerified = true;
  user.verificationTokenHash = undefined;
  user.verificationExpiresAt = undefined;
  await user.save();

  if (user.role === "candidate") {
    await initializeDashboard(user._id, user.name, user.email);
  }

  const jwtToken = signUser(user);
  res.json({ message: "Email verified successfully", token: jwtToken, user: sanitizeUser(user) });
}

async function resendVerification(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (user && !user.emailVerified) {
    await sendVerificationForUser(user);
  }

  // Same response whether or not the account exists / is already verified,
  // so this endpoint can't be used to enumerate registered emails.
  res.json({ message: "If an unverified account exists for that email, a new verification link has been sent." });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (user) {
    const { token, tokenHash, expiresAt } = generateResetToken();
    user.resetTokenHash = tokenHash;
    user.resetExpiresAt = expiresAt;
    await user.save();

    const resetUrl = `${originForRole(user.role)}/reset-password/${token}`;
    try {
      await sendPasswordResetEmail(user, resetUrl);
    } catch (err) {
      console.error("Failed to send password reset email:", err.message);
    }
  }

  res.json({ message: "If an account exists for that email, a password reset link has been sent." });
}

async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password are required" });
  if (!isStrongPassword(password)) return res.status(400).json({ error: STRONG_PASSWORD_MESSAGE });

  const user = await User.findOne({ resetTokenHash: hashToken(token) });
  if (!user || !user.resetExpiresAt || new Date() > user.resetExpiresAt) {
    return res.status(400).json({ error: "This reset link is invalid or has expired" });
  }

  user.passwordHash = await hashPassword(password);
  user.resetTokenHash = undefined;
  user.resetExpiresAt = undefined;
  await user.save();

  if (user.role === "admin" && user.company) {
    await notifyAdmin({
      companyId: user.company,
      type: "password_changed",
      title: "Password changed",
      message: `${user.name}'s account password was changed successfully.`,
    });
  } else {
    await notifyCandidate({
      userId: user._id,
      type: "password_changed",
      title: "Password changed",
      message: "Your account password was changed successfully.",
    });
  }

  const built = passwordChangedEmailTemplate(user);
  try {
    await dispatchEmail({
      to: user.email,
      subject: built.subject,
      text: built.text,
      html: built.html,
      category: "password_changed",
      relatedType: "User",
      relatedId: user._id,
    });
  } catch (err) {
    console.error("Failed to send password-changed email:", err.message);
  }

  res.json({ message: "Password reset successfully. You can now log in with your new password." });
}

async function me(req, res) {
  const sanitized = sanitizeUser(req.user);
  if (req.user.company) {
    const company = await Company.findById(req.user.company);
    if (company) {
      sanitized.company = {
        id: company._id,
        name: company.name,
        companyCode: company.companyCode,
        status: company.status,
      };
    }
  }
  res.json(sanitized);
}

module.exports = {
  register,
  adminRegister,
  login,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  me,
};
