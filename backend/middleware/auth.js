const jwt = require("jsonwebtoken");
const User = require("../models/User");

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

module.exports = { requireAuth, requireRole };
