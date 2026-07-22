// Rate-limiter factory. Backs limits with Redis (shared across instances) when
// REDIS_URL is configured, else an in-memory store (single-instance dev fallback).
// Used to bound the cost-amplification / DoS surface on the AI interview endpoints —
// each answer submission is an LLM call, and the speed-test ships a 2 MB payload.

const rateLimit = require("express-rate-limit");
const { getRedisConnection } = require("../config/redis");

function makeStore(prefix) {
  const conn = getRedisConnection();
  if (!conn) return undefined; // fall back to express-rate-limit's default MemoryStore
  const mod = require("rate-limit-redis");
  const RedisStore = mod.default || mod.RedisStore || mod;
  return new RedisStore({ prefix, sendCommand: (...args) => conn.call(...args) });
}

function createLimiter({ windowMs, max, prefix, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(prefix),
    keyGenerator,
    message: { error: message || "Too many requests — please slow down." },
  });
}

// Key interview-portal limits by the session's candidate (falls back to IP) so one
// magic-link token can't amplify cost regardless of source IP.
function portalKey(req) {
  return String(req.interviewSession?.candidate || req.ip);
}

module.exports = { createLimiter, portalKey };
