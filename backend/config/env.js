// Fail-fast environment validation. A missing critical secret should crash the process
// at boot with a clear message, not fail silently on the first request that needs it.

const { candidateLinkBase, isDisposableHost, isLocalHost } = require("../utils/corsOrigins");
const { billingEnforced, demoPlanKey } = require("../utils/billingMode");

function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  // Warn on EVERY boot, not only in production. This is the one flag that lets an
  // unpaid — or suspended — tenant reach a full workspace, so it must never be on
  // without being visible in the logs. A warning, not an error: it is a legitimate
  // demo/pilot configuration, just never an accidental one.
  if (!billingEnforced()) {
    warnings.push(
      `BILLING_ENFORCEMENT=off — the subscription paywall AND tenant suspension are NOT enforced. ` +
        `Any registered company is auto-provisioned on the "${demoPlanKey()}" plan without paying, and a ` +
        `suspended tenant can still log in. Demo/pilot only — remove this var and restart to re-enable.`
    );
  }

  // Emailed interview links outlive the process that sent them by days
  // (INTERVIEW_LINK_VALIDITY_HOURS, 48h default). Because only the token HASH is
  // stored, a link built on a hostname that later disappears cannot be regenerated
  // — the recruiter's only recovery is to rotate the token and re-email every
  // affected candidate. Catch it at boot, not in the inbox.
  const linkBase = candidateLinkBase();
  if (isDisposableHost(linkBase)) {
    const msg =
      `Candidate link base is a disposable dev tunnel (${linkBase}). Every interview ` +
      `invitation would embed a hostname that dies when the tunnel restarts. Set ` +
      `PUBLIC_CANDIDATE_URL to a permanent origin (it overrides CLIENT_ORIGIN_USER for links).`;
    if (isProd) errors.push(msg);
    else warnings.push(msg + " — emails sent from this run will break for the recipient.");
  } else if (isProd && isLocalHost(linkBase)) {
    errors.push(
      `Candidate link base resolves to ${linkBase}, which is unreachable from a candidate's ` +
        `browser. Set PUBLIC_CANDIDATE_URL to the public candidate-app origin.`
    );
  }

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
    // Without SMTP_HOST, utils/mailer.js silently uses nodemailer's jsonTransport: mail is
    // composed, EmailLog rows are marked "sent", the UI reports success — and nothing is ever
    // delivered. Account verification, password reset, and the company-registration OTP all
    // break with no error anywhere. This is an error, not a warning: a production deploy that
    // cannot send email is not a working deploy.
    if (!process.env.SMTP_HOST) {
      errors.push(
        "SMTP_HOST is required in production — without it NO EMAIL IS SENT (verification, password reset, OTP, invoices all silently fail while reporting success)"
      );
    }
    if (!process.env.MAIL_FROM) {
      warnings.push(
        'MAIL_FROM not set — falling back to no-reply@recruitment.local, an unroutable domain most receiving servers will reject or mark as spam'
      );
    }
    // storageService enables S3 only when all THREE are present, so checking the bucket
    // alone let a half-configured deploy fall through to local disk. On an ephemeral
    // filesystem (Render, Fly, any container platform) that destroys every uploaded
    // resume on the next restart, and the damage is not a missing file: extractResumeText
    // returns empty, and the candidate is scored on an empty document. Same class as the
    // SMTP_HOST check above — a deploy that cannot durably hold a resume is not a working
    // deploy, so it fails at boot rather than one application at a time.
    const s3Missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !process.env[k]);
    if (s3Missing.length && process.env.ALLOW_LOCAL_STORAGE === "true") {
      warnings.push(
        `Object storage not configured (missing ${s3Missing.join(", ")}) but ALLOW_LOCAL_STORAGE=true — resumes are ` +
          `written to backend/uploads. This is only safe on a single instance with persistent disk; on an ephemeral ` +
          `filesystem the files are lost on restart and candidates are then scored on empty text.`
      );
    } else if (s3Missing.length) {
      errors.push(
        `Object storage is not configured (missing ${s3Missing.join(", ")}) — files would fall back to LOCAL DISK. ` +
          `On an ephemeral filesystem every uploaded resume is destroyed on the next deploy or restart, after which ` +
          `screening extracts empty text and scores the candidate on nothing. Set ALLOW_LOCAL_STORAGE=true only if this ` +
          `host has genuinely persistent disk.`
      );
    }
    if (!process.env.CLIENT_ORIGIN_ADMIN || !process.env.CLIENT_ORIGIN_USER) {
      warnings.push("CLIENT_ORIGIN_ADMIN / CLIENT_ORIGIN_USER not both set — CORS may reject the frontends");
    }
    if (!process.env.OPENROUTER_API_KEY) {
      warnings.push("OPENROUTER_API_KEY not set — AI interviews run in deterministic fallback mode");
    }
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      warnings.push("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — checkout returns 503 and the UI shows 'Payments Coming Soon'");
    }
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      warnings.push("RAZORPAY_WEBHOOK_SECRET not set — EVERY payment webhook fails signature verification and returns 400");
    }
    if (!process.env.METRICS_TOKEN) {
      warnings.push("METRICS_TOKEN not set — GET /metrics is publicly readable");
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
