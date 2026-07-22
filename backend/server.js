require("dotenv").config();
const { validateEnv } = require("./config/env");
try {
  validateEnv();
} catch (err) {
  console.error("[server] " + err.message);
  process.exit(1);
}

const http = require("http");
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const connectDB = require("./config/db");
const { getRedisConnection } = require("./config/redis");
const jobRoutes = require("./routes/jobRoutes");
const candidateRoutes = require("./routes/candidateRoutes");
const resumeRoutes = require("./routes/resumeRoutes");
const interviewQueueRoutes = require("./routes/interviewQueueRoutes");
const interviewSessionRoutes = require("./routes/interviewSessionRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminNotificationRoutes = require("./routes/adminNotificationRoutes");
const notificationPreferenceRoutes = require("./routes/notificationPreferenceRoutes");
const interviewPortalRoutes = require("./routes/interviewPortalRoutes");
const authRoutes = require("./routes/authRoutes");
const companyAuthRoutes = require("./routes/companyAuthRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const candidateDashboardRoutes = require("./routes/candidateDashboardRoutes");
const dataRightsRoutes = require("./routes/dataRightsRoutes");
const companySettingsRoutes = require("./routes/companySettingsRoutes");
const { webhook } = require("./controllers/paymentController");
const { initSocket } = require("./config/socket");
const { startEmailWorker } = require("./workers/emailWorker");
const { startInterviewReminderJob } = require("./jobs/interviewReminderJob");
const { startSubscriptionExpiryJob } = require("./jobs/subscriptionExpiryJob");
const { startRetentionJob } = require("./jobs/retentionJob");
const { auditLog } = require("./middleware/auditLog");
const { requestContext, metricsEndpoint } = require("./middleware/observability");
const logger = require("./utils/logger");

// Last-resort safety net. This is a single-instance server with no supervisor restarting it
// on crash (nodemon only restarts on file change) — every live interview session and socket
// connection dies with the process. A rejected promise that misses an `await`/`.catch` (e.g. a
// third-party API resetting a connection mid-request) must not take the whole server down for
// every candidate over one request; log it and keep serving. Route-level errors should still be
// caught by asyncHandler + the global Express error middleware below — this only catches what
// slips past that (background jobs, cron, socket handlers).
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", {
    err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : { value: String(reason) },
  });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaught exception", { err: { message: err.message, stack: err.stack } });
});

const app = express();
app.set("trust proxy", 1); // behind Nginx/Caddy — req.ip reflects the real client, not the proxy

// Security headers. This is a JSON API (+ file downloads to the SPAs on other origins),
// so relax Cross-Origin-Resource-Policy to allow the admin/user apps to load resources
// (e.g. identity photos) cross-origin; keep the rest of helmet's defaults.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());

// Observability: assign a correlation id + request-scoped logger, then log + meter every
// request on finish. Registered before cors/routers so 404s and CORS rejections are counted.
app.use(requestContext);

app.use(
  cors({
    origin: [process.env.CLIENT_ORIGIN_ADMIN, process.env.CLIENT_ORIGIN_USER].filter(Boolean),
  })
);

// Razorpay webhook signature verification needs the exact raw request bytes,
// so this route is registered with a raw-body parser ahead of the global
// express.json() middleware below (which would otherwise consume the stream
// and reserialize it, breaking signature verification).
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch {
      req.body = {};
    }
    next();
  },
  webhook
);

// Bounded JSON body — resumes/photos go through multer (multipart), so a small limit
// here is safe and caps a cheap DoS vector (huge JSON bodies). Configurable via env.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

// Audit trail: records every authenticated mutating request (who/what/tenant/outcome)
// once the response finishes. Registered before the routers so its res-finish hook is
// in place; it no-ops for anonymous/GET traffic. See middleware/auditLog.js.
app.use(auditLog);

// Liveness: is the process up? (used by the LB/orchestrator to decide restart)
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Readiness: can this instance actually serve traffic? Checks its dependencies so the
// LB stops routing to an instance whose Mongo/Redis is down instead of failing requests.
app.get("/api/ready", (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const redis = getRedisConnection();
  const redisReady = !redis || redis.status === "ready"; // Redis optional in dev
  const ready = mongoReady && redisReady;
  res.status(ready ? 200 : 503).json({ ready, mongo: mongoReady, redis: redisReady });
});

// Prometheus scrape endpoint (token-guarded when METRICS_TOKEN is set). See middleware/observability.js.
app.get("/metrics", metricsEndpoint);

app.use("/api/jobs", jobRoutes);
app.use("/api/candidates", candidateRoutes);
app.use("/api/resumes", resumeRoutes);
app.use("/api/interview-queue", interviewQueueRoutes);
app.use("/api/interview-sessions", interviewSessionRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin-notifications", adminNotificationRoutes);
app.use("/api/notification-preferences", notificationPreferenceRoutes);
app.use("/api/interview-portal", interviewPortalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyAuthRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/candidate-dashboard", candidateDashboardRoutes);
app.use("/api/data-rights", dataRightsRoutes);
app.use("/api/company-settings", companySettingsRoutes);

app.use((err, req, res, next) => {
  (req.log || logger).error("request error", {
    err: { message: err.message, stack: err.stack },
    path: req.originalUrl,
  });
  res.status(400).json({ error: err.message || "Something went wrong" });
});

const PORT = process.env.PORT || 9000;
const httpServer = http.createServer(app);

// Bound how long a socket may take sending headers / the whole request, so a slow or
// stuck client (Slowloris-style) can't tie up a connection indefinitely. headersTimeout
// must exceed requestTimeout. Values in ms; tunable via env.
httpServer.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 30000;
httpServer.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS) || 35000;

// Background jobs (email worker + cron) run IN the API process by default, which is
// correct for single-instance dev/pilot. For multi-instance production, set
// RUN_WORKERS_IN_API=false on the API instances and run one `npm run worker` process,
// so cron fires exactly once (avoids the duplicate-email double-fire at N replicas).
const runWorkersInApi = process.env.RUN_WORKERS_IN_API !== "false";
let emailWorker = null;

connectDB()
  .then(() => {
    initSocket(httpServer);
    if (runWorkersInApi) {
      emailWorker = startEmailWorker();
      startInterviewReminderJob();
      startSubscriptionExpiryJob();
      startRetentionJob();
    } else {
      logger.info("RUN_WORKERS_IN_API=false — email worker + cron run in the separate worker process");
    }
    httpServer.listen(PORT, () => logger.info("server listening", { port: PORT }));
  })
  .catch((err) => {
    logger.error("failed to connect to MongoDB", { err: { message: err.message } });
    process.exit(1);
  });

// Graceful shutdown: stop accepting new connections, then drain sockets, worker, and DB.
// Without this, a rolling deploy/autoscale-down kills in-flight requests and jobs.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down gracefully", { signal });
  const forceExit = setTimeout(() => {
    logger.error("forced exit after 10s");
    process.exit(1);
  }, 10000);
  try {
    await new Promise((resolve) => httpServer.close(resolve));
    const { getIO } = require("./config/socket");
    getIO()?.close();
    if (emailWorker) await emailWorker.close();
    await mongoose.disconnect();
    clearTimeout(forceExit);
    logger.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error("error during shutdown", { err: { message: err.message } });
    process.exit(1);
  }
}
["SIGTERM", "SIGINT"].forEach((sig) => process.on(sig, () => shutdown(sig)));
