// CLIENT_ORIGIN_ADMIN / CLIENT_ORIGIN_USER may each hold a comma-separated list of
// origins (e.g. "http://192.168.1.23:5174,http://localhost:5174") so the same Vite
// dev server can be reached both from the host machine (localhost) and from a phone
// or other device on the LAN, without disabling CORS or juggling two different .env
// files for the same running server.

function parseOrigins(...envValues) {
  return envValues
    .filter(Boolean)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

// Link-builders (magic-link emails, QR pairing URLs, password-reset links) need
// exactly ONE base URL, not a CORS allow-list — take the first configured origin
// (the one meant to be shared/scanned), falling back to `fallback` when unset.
function firstOrigin(envValue, fallback) {
  const [first] = parseOrigins(envValue);
  return first || fallback;
}

// Hostnames handed out by dev-tunnel services. Every one of them is disposable:
// the name is re-randomised on each run (trycloudflare) or tied to a session that
// ends when the laptop sleeps. An interview link is valid for INTERVIEW_LINK_VALIDITY_HOURS
// (48h by default) and the invitation email tells the candidate to "take it whenever
// suits you" — a hostname that dies in hours cannot honour a promise measured in days.
// Only the token HASH is persisted, so a link built on one of these is unrecoverable
// once the host is gone (the raw token still is, but only if the candidate still has
// the email to copy it out of).
const DISPOSABLE_HOST_PATTERNS = [
  /(^|\.)trycloudflare\.com$/i,
  /(^|\.)ngrok(-free)?\.(app|io|dev)$/i,
  /(^|\.)devtunnels\.ms$/i,
  /(^|\.)loca\.lt$/i,
  /(^|\.)serveo\.net$/i,
  /(^|\.)tunnelmole\.net$/i,
];

// A bare host ("app.onrender.com") is a very easy thing to paste into
// PUBLIC_CANDIDATE_URL — Render/Vercel/Netlify all display the hostname without a
// scheme. Without this, buildInterviewUrl emits "app.onrender.com/interview/<token>",
// which mail clients render as a relative path and no browser will open.
function normalizeBase(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function hostOf(url) {
  try {
    return new URL(normalizeBase(url)).hostname;
  } catch {
    return "";
  }
}

// Exported so boot-time validation can refuse to start a production deploy that
// would email links nobody can open. See config/env.js.
function isDisposableHost(url) {
  const host = hostOf(url);
  return Boolean(host) && DISPOSABLE_HOST_PATTERNS.some((re) => re.test(host));
}

function isLocalHost(url) {
  const host = hostOf(url);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || /^192\.168\./.test(host) || /^10\./.test(host);
}

// The base for CANDIDATE-facing links that go into emails (interview magic
// links, QR pairing). PUBLIC_CANDIDATE_URL, when set, wins over the CORS list —
// emailed links must never depend on the ORDER of CLIENT_ORIGIN_USER, where a
// dev tunnel (trycloudflare etc.) listed first silently bakes a disposable
// hostname into every invitation, and every link dies when the tunnel does.
function candidateLinkBase(fallback = "http://localhost:5174") {
  return normalizeBase(firstOrigin(process.env.PUBLIC_CANDIDATE_URL || process.env.CLIENT_ORIGIN_USER, fallback));
}

module.exports = { parseOrigins, firstOrigin, candidateLinkBase, isDisposableHost, isLocalHost, normalizeBase };
