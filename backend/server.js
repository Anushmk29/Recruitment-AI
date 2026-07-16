require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
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
const { webhook } = require("./controllers/paymentController");
const { initSocket } = require("./config/socket");
const { startEmailWorker } = require("./workers/emailWorker");
const { startInterviewReminderJob } = require("./jobs/interviewReminderJob");
const { startSubscriptionExpiryJob } = require("./jobs/subscriptionExpiryJob");

const app = express();

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

app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Something went wrong" });
});

const PORT = process.env.PORT || 9000;
const httpServer = http.createServer(app);

connectDB()
  .then(() => {
    initSocket(httpServer);
    startEmailWorker();
    startInterviewReminderJob();
    startSubscriptionExpiryJob();
    httpServer.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  });
