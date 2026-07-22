const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Company = require("../models/Company");
const tenantContext = require("../utils/tenantContext");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.AUTH_JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Session expired or invalid, please log in again" });
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    return res.status(401).json({ error: "Account not found" });
  }

  req.user = user;
  // Run the rest of the request inside a tenant context so the tenantScope plugin
  // auto-scopes every tenant-model query to this user's company. companyId is
  // undefined for candidate accounts / superadmin (no tenant) — those are not scoped.
  tenantContext.run(
    {
      companyId: user.company ? String(user.company) : undefined,
      userId: String(user._id),
      role: user.role,
    },
    () => next()
  );
}

// Populates req.user (and a tenant context) IF a valid bearer token is present, but
// never rejects when it's absent or invalid. For endpoints that are public but return
// richer/owner-only data to an authenticated caller (e.g. GET /jobs/:id showing a draft
// to its owning admin).
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next();
  try {
    const payload = jwt.verify(token, process.env.AUTH_JWT_SECRET);
    const user = await User.findById(payload.userId);
    if (user) {
      req.user = user;
      return tenantContext.run(
        {
          companyId: user.company ? String(user.company) : undefined,
          userId: String(user._id),
          role: user.role,
        },
        () => next()
      );
    }
  } catch {
    // Invalid token on an optional-auth route → treat as anonymous.
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have access to this resource" });
    }
    next();
  };
}

// Blocks company-scoped product access when the tenant isn't active (suspended, or
// still pending payment/verification). Enforced per-request so a status change takes
// effect immediately, not only at the next login. Identities without a company
// (candidate accounts, superadmin) pass through — apply this only on admin routers,
// and never on the billing/onboarding routes a pending company needs to become active.
async function requireActiveCompany(req, res, next) {
  try {
    if (!req.user || !req.user.company) return next();
    const company = await Company.findById(req.user.company).select("status");
    if (!company) return res.status(403).json({ error: "Company account not found" });
    if (company.status !== "active") {
      return res.status(403).json({
        error: "Your company account is not active. Complete payment or contact support to continue.",
        code: "COMPANY_INACTIVE",
        status: company.status,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, optionalAuth, requireRole, requireActiveCompany };
