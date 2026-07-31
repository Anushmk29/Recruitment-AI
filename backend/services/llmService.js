// Thin OpenRouter wrapper for the AI platform. Isolated here so the LLM provider
// is swappable and so the rest of the app can run WITHOUT an API key (mirrors the
// mailer's jsonTransport degradation): if no key is configured, isEnabled() is
// false and callers fall back to deterministic logic.
//
// Hardened for production (W3 + BUILD-PLAN Phase 2): every call has a hard timeout
// (no hung sockets), retries transient failures with backoff, and returns
// token/cost usage so callers can meter + budget-cap per tenant. Structured
// outputs use response_format json_schema. On top of that, Phase 2 adds:
//   - a deterministic response cache (llmCache) keyed by the full request shape
//     including promptVersion — reproducibility for free, no duplicate spend;
//   - a circuit breaker — after K consecutive provider failures, fail fast for a
//     cooldown instead of burning retries × timeout per request, so callers hit
//     their deterministic fallbacks immediately; state exposed on /metrics;
//   - generateJSONEnsemble — N-way sampling with agreement computed IN CODE
//     (utils/ensemble), never by asking a model whether its answers agree;
//   - promptVersion as a first-class request field: it is part of the cache key
//     and the record/replay fixture key, so a prompt edit invalidates cleanly.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const llmCache = require("./llmCache");
const metrics = require("../utils/metrics");
const { computeConsensus } = require("../utils/ensemble");

const MODEL = process.env.AI_INTERVIEW_MODEL || "openai/gpt-4o-mini";
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

// Config is read at call time (not module load) so tests — and ops flipping a
// flag — never need a process restart to take effect.
function baseUrl() {
  return (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}
function timeoutMs() {
  return Number(process.env.LLM_TIMEOUT_MS) || 30000;
}
// Extraction-class calls (whole-résumé ClaimGraph, rubric × claim matching) emit
// thousands of JSON tokens and legitimately run past a minute — measured ~75s for
// a 9k-char résumé at 16k max_tokens. They must NOT share the interactive default:
// a 30s ceiling made every one of them abort mid-stream, so the evidence engine
// silently degraded to the legacy keyword scorer on every single application.
// Call sites opt in explicitly via generateJSON({ timeoutMs: heavyTimeoutMs() }).
function heavyTimeoutMs() {
  return Number(process.env.LLM_TIMEOUT_HEAVY_MS) || 180000;
}
function maxRetries() {
  // `|| 2` would swallow an explicit 0 — zero retries is a legitimate setting.
  const raw = process.env.LLM_MAX_RETRIES;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}
function apiKey() {
  return process.env.OPENROUTER_API_KEY || "";
}

// --- Record/replay (BUILD-PLAN Phase 1.6) -----------------------------------
// LLM_RECORD=1  → make the live call, then persist {request, response} to disk
//                 keyed by a hash of the request, for later replay.
// LLM_REPLAY=1  → never touch the network: serve the recorded response for this
//                 exact request, or throw LLM_REPLAY_MISS. This is how CI tests
//                 the AI paths deterministically and for free.
// Env is read at call time (not module load) so tests can toggle modes.

function replayEnabled() {
  return process.env.LLM_REPLAY === "1";
}

function recordEnabled() {
  return process.env.LLM_RECORD === "1";
}

function fixturesDir() {
  return process.env.LLM_FIXTURES_DIR || path.join(__dirname, "..", "test", "fixtures", "llm");
}

// JSON.stringify with sorted object keys, so the same logical request always
// hashes to the same key regardless of property order.
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function requestKey(reqShape) {
  return crypto.createHash("sha256").update(stableStringify(reqShape)).digest("hex");
}

function isEnabled() {
  // Replay mode counts as enabled: callers must take their LLM code path so the
  // recorded fixtures — not the deterministic fallback — are what CI exercises.
  return replayEnabled() || (typeof fetch === "function" && Boolean(apiKey()));
}

// --- Circuit breaker (BUILD-PLAN Phase 2.4) ----------------------------------
// Counts CONSECUTIVE provider-health failures (network, timeout, 5xx, 429).
// Non-retryable 4xx responses are OUR bug (bad schema, bad key), not provider
// sickness, and do not trip the breaker. After the threshold, the breaker opens:
// calls throw LLM_BREAKER_OPEN instantly so callers reach their deterministic
// fallback in milliseconds instead of after retries × timeout. When the cooldown
// elapses the breaker goes half-open: traffic is let through, the first settled
// result decides (success closes, another provider failure re-opens).

const breaker = { failures: 0, openedAt: 0, state: "closed" };

function breakerThreshold() {
  return Number(process.env.LLM_BREAKER_THRESHOLD) || 5;
}
function breakerCooldownMs() {
  return Number(process.env.LLM_BREAKER_COOLDOWN_MS) || 60000;
}

function publishBreakerGauge() {
  metrics.setGauge("llm_breaker_state", {}, breaker.state === "open" ? 2 : breaker.state === "half_open" ? 1 : 0);
}

// Current state, resolving an elapsed cooldown to half-open.
function breakerState() {
  if (breaker.state === "open" && Date.now() - breaker.openedAt >= breakerCooldownMs()) {
    breaker.state = "half_open";
    publishBreakerGauge();
  }
  return breaker.state;
}

function breakerRecordFailure() {
  breaker.failures += 1;
  if (breaker.state === "half_open" || breaker.failures >= breakerThreshold()) {
    if (breaker.state !== "open") metrics.incCounter("llm_breaker_opens_total");
    breaker.state = "open";
    breaker.openedAt = Date.now();
    console.warn(`[llm] circuit breaker OPEN after ${breaker.failures} consecutive provider failure(s); cooling down ${breakerCooldownMs()}ms`);
  }
  publishBreakerGauge();
}

function breakerRecordSuccess() {
  if (breaker.state !== "closed") console.log("[llm] circuit breaker closed — provider recovered");
  breaker.failures = 0;
  breaker.state = "closed";
  breaker.openedAt = 0;
  publishBreakerGauge();
}

function _resetBreakerForTests() {
  breaker.failures = 0;
  breaker.state = "closed";
  breaker.openedAt = 0;
  publishBreakerGauge();
}

function extraHeaders() {
  const h = {};
  if (process.env.OPENROUTER_SITE_URL) h["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) h["X-Title"] = process.env.OPENROUTER_APP_NAME;
  return h;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extract a JSON object from a response that may wrap it in prose or a ```json fence.
function parseJson(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("LLM response was not valid JSON");
}

// One attempt. Throws with `.retryable` set so the retry loop knows what to do.
async function attempt({ system, prompt, schema, maxTokens, model, temperature, timeoutMs: callTimeoutMs }) {
  const budget = callTimeoutMs || timeoutMs();
  const body = {
    model: model || MODEL,
    max_tokens: maxTokens,
    temperature: typeof temperature === "number" ? temperature : 0,
    usage: { include: true }, // ask OpenRouter to return token + cost usage
    messages: [
      {
        role: "system",
        content: `${system}\n\nRespond ONLY with a single JSON object matching the requested schema. No prose, no markdown fences.`,
      },
      { role: "user", content: prompt },
    ],
  };
  if (schema) {
    body.response_format = { type: "json_schema", json_schema: { name: "response", strict: true, schema } };
  }

  let res;
  let data;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...extraHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(budget),
    });
    // The abort covers the WHOLE exchange, not just the headers. A long
    // generation returns headers in ~2s and then streams the body for another
    // minute, so the timeout almost always fires inside the body read — which
    // must therefore sit INSIDE this try. When it didn't, the raw DOMException
    // ("The operation was aborted due to timeout", code 23) escaped without
    // `.retryable`, so the retry loop skipped it, the breaker never counted it,
    // and callers saw an unclassifiable error instead of a timeout.
    if (res.ok) data = await res.json();
  } catch (err) {
    // Network error or timeout (Timeout/AbortError) — always retryable.
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    const e = new Error(timedOut ? `LLM request timed out after ${budget}ms` : `LLM request failed: ${err.message}`);
    e.retryable = true;
    if (timedOut) e.code = "LLM_TIMEOUT";
    throw e;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const e = new Error(`OpenRouter request failed (${res.status}): ${detail.slice(0, 300)}`);
    e.retryable = RETRYABLE_STATUS.has(res.status);
    const retryAfter = Number(res.headers.get("retry-after"));
    if (retryAfter) e.retryAfterMs = retryAfter * 1000;
    throw e;
  }

  if (data.error) {
    const e = new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
    e.retryable = false;
    throw e;
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw Object.assign(new Error("LLM returned no content"), { retryable: false });

  // Truncation is a CONFIGURATION fault (maxTokens too low for this input), not a
  // model defect. Left undetected it reaches parseJson as a half-written object
  // and reports "LLM response was not valid JSON", which sends debugging after
  // the wrong thing entirely. Name it precisely instead. Not retryable: an
  // identical retry truncates at exactly the same place.
  if (choice.finish_reason === "length" || choice.native_finish_reason === "length") {
    throw Object.assign(
      new Error(`LLM output hit the ${maxTokens}-token cap and was truncated before the JSON closed — raise maxTokens for this call site`),
      { retryable: false, code: "LLM_TRUNCATED" }
    );
  }

  const u = data.usage || {};
  const usage = {
    promptTokens: u.prompt_tokens || 0,
    completionTokens: u.completion_tokens || 0,
    // OpenRouter returns cost in USD credits when usage.include=true.
    costCents: u.cost != null ? Math.round(Number(u.cost) * 100 * 100) / 100 : 0,
  };
  return { data: parseJson(content), usage, model: data.model || body.model };
}

function countRequest(outcome, model) {
  metrics.incCounter("llm_requests_total", { outcome, model: model || MODEL });
}

/**
 * Ask the configured model for a JSON object matching `schema`, with timeout,
 * retry, deterministic caching, and a circuit breaker.
 * Returns { data, usage: { promptTokens, completionTokens, costCents }, model,
 * cached?, replayed? }. Throws LLM_DISABLED (no key), LLM_BREAKER_OPEN (provider
 * down, fail fast), LLM_REPLAY_MISS (replay mode, unrecorded request), or the
 * last provider error after retries.
 *
 * `promptVersion` is part of the cache AND record/replay key — bump it whenever
 * the prompt template changes so stale decisions can never be served (Phase 2.6).
 */
async function generateJSON({ system, prompt, schema, maxTokens = 768, model, temperature, promptVersion, timeoutMs: callTimeoutMs }) {
  // NOTE: `timeoutMs` is deliberately absent from reqShape. It is a transport
  // deadline, not part of the request's meaning — including it would fragment
  // the cache and the replay fixtures across pure ops tuning.
  const reqShape = {
    model: model || MODEL,
    system,
    prompt,
    schema: schema || null,
    maxTokens,
    temperature: typeof temperature === "number" ? temperature : 0,
    promptVersion: promptVersion || null,
  };
  const key = requestKey(reqShape);

  if (replayEnabled()) {
    const file = path.join(fixturesDir(), `${key}.json`);
    if (!fs.existsSync(file)) {
      const err = new Error(
        `LLM replay miss: no recorded fixture for this request (key ${key}). ` +
          `Record one with LLM_RECORD=1 against the live API, or the request changed since recording.`
      );
      err.code = "LLM_REPLAY_MISS";
      err.requestKey = key;
      throw err;
    }
    const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
    countRequest("replay", reqShape.model);
    return { ...fixture.response, replayed: true };
  }

  if (!isEnabled()) {
    countRequest("disabled", reqShape.model);
    const err = new Error("LLM is not configured");
    err.code = "LLM_DISABLED";
    throw err;
  }

  // Deterministic cache — only for temperature-0 requests (a non-zero temperature
  // asks for variance; caching it would misrepresent sampling as determinism), and
  // skipped in record mode, which exists precisely to make a live call. Checked
  // BEFORE the breaker: serving known-good cached results while the provider is
  // down is strictly better than failing.
  const cacheable = reqShape.temperature === 0 && !recordEnabled();
  if (cacheable) {
    const hit = await llmCache.get(key);
    if (hit) {
      countRequest("cache_hit", reqShape.model);
      // Usage is zeroed: a hit spends no tokens, and reporting the original
      // usage would double-count spend in per-tenant metering.
      return { data: hit.data, usage: { promptTokens: 0, completionTokens: 0, costCents: 0 }, model: hit.model, cached: true };
    }
  }

  if (breakerState() === "open") {
    countRequest("breaker_open", reqShape.model);
    const err = new Error("LLM circuit breaker is open (provider failing); using fallback until cooldown elapses");
    err.code = "LLM_BREAKER_OPEN";
    throw err;
  }

  const t0 = Date.now();
  let lastErr;
  for (let i = 0; i <= maxRetries(); i++) {
    try {
      const result = await attempt({ system, prompt, schema, maxTokens, model, temperature, timeoutMs: callTimeoutMs });
      breakerRecordSuccess();
      countRequest("success", reqShape.model);
      metrics.observeHistogram("llm_request_duration_ms", { model: reqShape.model }, Date.now() - t0);
      if (result.usage.costCents) metrics.incCounter("llm_cost_cents_total", {}, result.usage.costCents);
      if (recordEnabled()) {
        fs.mkdirSync(fixturesDir(), { recursive: true });
        fs.writeFileSync(
          path.join(fixturesDir(), `${key}.json`),
          JSON.stringify({ key, request: reqShape, response: result, recordedAt: new Date().toISOString() }, null, 2)
        );
      }
      if (cacheable) await llmCache.set(key, result);
      return result;
    } catch (err) {
      lastErr = err;
      if (err.retryable) {
        breakerRecordFailure();
        // The breaker opening mid-loop means the provider is down — stop burning
        // the remaining retries and let the caller fall back now.
        if (breaker.state === "open") break;
      }
      if (!err.retryable || i === maxRetries()) break;
      const backoff = err.retryAfterMs || Math.min(8000, 500 * 2 ** i);
      console.warn(`[llm] attempt ${i + 1} failed (${err.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  countRequest("error", reqShape.model);
  throw lastErr;
}

// --- Ensemble (BUILD-PLAN Phase 2.1) -----------------------------------------

function ensembleEnabled() {
  const v = process.env.LLM_ENSEMBLE_ENABLED;
  return v === "1" || v === "true";
}
function ensembleMaxN() {
  return Number(process.env.LLM_ENSEMBLE_MAX_N) || 5;
}

// Default perturbation for samples beyond the first. Temperature-0 sampling of an
// identical prompt is (near-)deterministic and would also hit the cache, so extra
// samples must differ in bytes without differing in task. Callers with structured
// prompts should pass their own `perturb(prompt, i)` that genuinely reorders
// sections (Phase 7 self-consistency does); this fallback appends an explicit
// no-op marker, which is honest about its mechanism.
function defaultPerturb(prompt, i) {
  return `${prompt}\n\n(Consistency sample ${i + 1}: re-derive your answer from the source material independently. This line is not part of the task.)`;
}

/**
 * N-way sampled generation with code-computed agreement (never model-judged).
 * Gated by LLM_ENSEMBLE_ENABLED — when off, n collapses to 1 (guardrail: ensemble
 * cost is N×, so multi-sampling is an explicit opt-in per environment), and n is
 * clamped to LLM_ENSEMBLE_MAX_N regardless of what the caller asks for.
 *
 * Returns { samples, consensus, agreement, fieldAgreement, disagreements,
 * unanimous, usage (summed), model, requested, n, failures }. Requires a strict
 * majority of samples to succeed; otherwise throws the first sample error.
 * Low `agreement` means the INPUT is ambiguous — route it to a human (rule 4),
 * never average conflicting readings into a falsely confident number.
 */
async function generateJSONEnsemble({ n = 1, system, prompt, schema, maxTokens, model, temperature, promptVersion, perturb, timeoutMs: callTimeoutMs }) {
  const requested = Math.max(1, Math.floor(n));
  const count = ensembleEnabled() ? Math.min(requested, ensembleMaxN()) : 1;

  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => {
      const p = i === 0 ? prompt : (perturb || defaultPerturb)(prompt, i);
      return generateJSON({ system, prompt: p, schema, maxTokens, model, temperature, promptVersion, timeoutMs: callTimeoutMs });
    })
  );

  const samples = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const failures = settled.filter((s) => s.status === "rejected");
  if (samples.length < Math.floor(count / 2) + 1) {
    throw failures[0].reason;
  }

  const usage = samples.reduce(
    (acc, s) => ({
      promptTokens: acc.promptTokens + (s.usage?.promptTokens || 0),
      completionTokens: acc.completionTokens + (s.usage?.completionTokens || 0),
      costCents: Math.round((acc.costCents + (s.usage?.costCents || 0)) * 100) / 100,
    }),
    { promptTokens: 0, completionTokens: 0, costCents: 0 }
  );

  const agreementReport = computeConsensus(samples.map((s) => s.data));
  return {
    samples,
    ...agreementReport,
    usage,
    model: samples[0].model,
    requested,
    n: count,
    failures: failures.length,
  };
}

module.exports = {
  isEnabled,
  generateJSON,
  generateJSONEnsemble,
  heavyTimeoutMs,
  breakerState,
  MODEL,
  requestKey,
  stableStringify,
  _resetBreakerForTests,
};
