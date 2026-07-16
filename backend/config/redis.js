const IORedis = require("ioredis");

let connection = null;
let attempted = false;

// Redis/BullMQ are optional infrastructure: if REDIS_URL isn't configured
// (e.g. local dev on this machine), emailDispatchService falls back to
// sending inline instead of queueing, the same graceful-degrade pattern the
// codebase already uses for Razorpay (razorpayService.isConfigured()).
function getRedisConnection() {
  if (attempted) return connection;
  attempted = true;

  if (!process.env.REDIS_URL) {
    console.log("[redis] REDIS_URL not set — emails will be sent inline instead of via the BullMQ queue");
    return null;
  }

  connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", (err) => console.error("[redis] connection error:", err.message));
  return connection;
}

module.exports = { getRedisConnection };
