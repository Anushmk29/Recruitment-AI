// Fail-fast environment validation. A missing critical secret should crash the process
// at boot with a clear message, not fail silently on the first request that needs it.

function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  // Both JWT secrets are always required — mixing them up (or missing one) breaks auth
  // or the interview portal silently. See CLAUDE.md.
  ["AUTH_JWT_SECRET", "JWT_SECRET"].forEach((k) => {
    if (!process.env[k]) errors.push(`Missing required env ${k}`);
  });

  if (!process.env.MONGODB_URI) {
    warnings.push("MONGODB_URI not set — defaulting to mongodb://127.0.0.1:27017/recruitment");
  }

  if (isProd) {
    // In production the app is expected to run multiple instances behind a load balancer.
    // Redis is the shared backbone (Socket.io adapter, BullMQ, distributed cron claims,
    // shared rate limiting), so it's required, not optional.
    if (!process.env.REDIS_URL) {
      errors.push("REDIS_URL is required in production (Socket.io adapter, queues, cron locks, rate limiting)");
    }
    if (!process.env.S3_BUCKET) {
      warnings.push(
        "S3 storage not configured — files fall back to LOCAL DISK, which is unsafe with more than one instance (set S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)"
      );
    }
    if (!process.env.CLIENT_ORIGIN_ADMIN || !process.env.CLIENT_ORIGIN_USER) {
      warnings.push("CLIENT_ORIGIN_ADMIN / CLIENT_ORIGIN_USER not both set — CORS may reject the frontends");
    }
    if (!process.env.OPENROUTER_API_KEY) {
      warnings.push("OPENROUTER_API_KEY not set — AI interviews run in deterministic fallback mode");
    }
  }

  warnings.forEach((w) => console.warn("[env] " + w));
  if (errors.length) {
    errors.forEach((e) => console.error("[env] " + e));
    throw new Error(`Environment validation failed with ${errors.length} error(s). Fix the above and restart.`);
  }
  console.log(`[env] validation passed${isProd ? " (production)" : ""}`);
}

module.exports = { validateEnv };
