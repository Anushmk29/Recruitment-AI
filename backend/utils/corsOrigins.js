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

// The base for CANDIDATE-facing links that go into emails (interview magic
// links, QR pairing). PUBLIC_CANDIDATE_URL, when set, wins over the CORS list —
// emailed links must never depend on the ORDER of CLIENT_ORIGIN_USER, where a
// dev tunnel (trycloudflare etc.) listed first silently bakes a disposable
// hostname into every invitation, and every link dies when the tunnel does.
function candidateLinkBase(fallback = "http://localhost:5174") {
  return firstOrigin(process.env.PUBLIC_CANDIDATE_URL || process.env.CLIENT_ORIGIN_USER, fallback).replace(/\/+$/, "");
}

module.exports = { parseOrigins, firstOrigin, candidateLinkBase };
