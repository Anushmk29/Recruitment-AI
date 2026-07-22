// Thin OpenRouter wrapper for the AI Interview Engine. Isolated here so the LLM
// provider is swappable and so the rest of the app can run WITHOUT an API key
// (mirrors the mailer's jsonTransport degradation): if no key is configured,
// isEnabled() is false and callers fall back to deterministic logic.
//
// Hardened for production (W3): every call has a hard timeout (no hung sockets),
// retries transient failures with backoff, and returns token/cost usage so callers
// can meter + budget-cap per tenant. Structured outputs use response_format json_schema.

const BASE_URL = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const MODEL = process.env.AI_INTERVIEW_MODEL || "openai/gpt-4o-mini";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 30000;
const MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES) || 2;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function apiKey() {
  return process.env.OPENROUTER_API_KEY || "";
}

function isEnabled() {
  return typeof fetch === "function" && Boolean(apiKey());
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
async function attempt({ system, prompt, schema, maxTokens, model, temperature }) {
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
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...extraHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network error or timeout (AbortError) — always retryable.
    const e = new Error(err.name === "TimeoutError" ? `LLM request timed out after ${TIMEOUT_MS}ms` : `LLM request failed: ${err.message}`);
    e.retryable = true;
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

  const data = await res.json();
  if (data.error) {
    const e = new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
    e.retryable = false;
    throw e;
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw Object.assign(new Error("LLM returned no content"), { retryable: false });

  const u = data.usage || {};
  const usage = {
    promptTokens: u.prompt_tokens || 0,
    completionTokens: u.completion_tokens || 0,
    // OpenRouter returns cost in USD credits when usage.include=true.
    costCents: u.cost != null ? Math.round(Number(u.cost) * 100 * 100) / 100 : 0,
  };
  return { data: parseJson(content), usage, model: data.model || body.model };
}

/**
 * Ask the configured model for a JSON object matching `schema`, with timeout + retry.
 * Returns { data, usage: { promptTokens, completionTokens, costCents }, model }.
 * Throws (code LLM_DISABLED) when no key is configured, or the last error after retries.
 */
async function generateJSON({ system, prompt, schema, maxTokens = 768, model, temperature }) {
  if (!isEnabled()) {
    const err = new Error("LLM is not configured");
    err.code = "LLM_DISABLED";
    throw err;
  }

  let lastErr;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await attempt({ system, prompt, schema, maxTokens, model, temperature });
    } catch (err) {
      lastErr = err;
      if (!err.retryable || i === MAX_RETRIES) throw err;
      const backoff = err.retryAfterMs || Math.min(8000, 500 * 2 ** i);
      console.warn(`[llm] attempt ${i + 1} failed (${err.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

module.exports = { isEnabled, generateJSON, MODEL };
