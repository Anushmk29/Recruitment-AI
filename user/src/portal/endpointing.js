// Mirror of backend/utils/endpointing.js — deciding when a candidate has actually finished.
//
// Duplicated across the boundary on purpose, exactly as detectRepeat in useVoiceInterview.js
// mirrors backend/utils/repeatIntent.js: the decision has to be made in the browser because only
// the browser knows, in real time, when the silence started and what the microphone energy did.
// The NUMBERS are not duplicated — completeWaitMs, holdingWaitMs and the rest arrive from the
// server with the streaming credential, so a tenant's interview conditions stay configured in
// one place. Only the classification runs here.
//
// See the backend file for why this is deterministic code and not a model call. Short version:
// a person responds in ~200ms, no round-trip fits; and "it cut me off" has to be answerable from
// the record afterwards.

const HOLDING_WORDS = new Set([
  "and", "but", "or", "nor", "so", "yet", "because", "since", "although", "though", "while",
  "whereas", "unless", "until", "if", "when", "whenever", "where", "whether", "as",
  "to", "of", "for", "with", "without", "in", "into", "on", "onto", "at", "by", "from", "about",
  "over", "under", "through", "between", "against", "during", "before", "after", "within",
  "a", "an", "the", "my", "our", "your", "their", "his", "her", "its", "this", "that", "these",
  "those", "some", "any", "every", "each", "another", "both", "such",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "have", "has",
  "had", "will", "would", "can", "could", "should", "shall", "may", "might", "must",
  "then", "also", "plus", "like", "which", "who", "whom", "whose", "than", "very", "really",
  "quite", "just", "even", "still", "actually", "basically", "essentially",
]);

const FILLERS = new Set(["um", "uh", "erm", "uhm", "hmm", "mmm", "er", "ah", "eh"]);

const HOLDING_PHRASES = [
  "you know", "sort of", "kind of", "i mean", "let me think", "let me see", "hold on",
  "one second", "give me a second", "one moment", "what else", "and then", "so that",
  "such as", "for example", "for instance", "as well as", "which is", "which was",
];

// Used only if the server sent no endpointing policy (older backend). Deliberately generous:
// with no configuration to trust, the safe failure is waiting too long, never cutting someone off.
const FALLBACK = {
  completeWaitMs: 900,
  ambiguousWaitMs: 1800,
  holdingWaitMs: 4500,
  minCompleteWords: 8,
};

export function normalizeEndpointing(cfg) {
  const num = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);
  return {
    completeWaitMs: num(cfg?.completeWaitMs, FALLBACK.completeWaitMs),
    ambiguousWaitMs: num(cfg?.ambiguousWaitMs, FALLBACK.ambiguousWaitMs),
    holdingWaitMs: num(cfg?.holdingWaitMs, FALLBACK.holdingWaitMs),
    minCompleteWords: num(cfg?.minCompleteWords, FALLBACK.minCompleteWords),
  };
}

function words(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

export function isHolding(text) {
  const w = words(text);
  if (!w.length) return true;
  const last = w[w.length - 1];
  if (FILLERS.has(last) || HOLDING_WORDS.has(last)) return true;
  const tail = w.slice(-3).join(" ");
  return HOLDING_PHRASES.some((p) => tail.endsWith(p));
}

export function hasTerminalPunctuation(text) {
  return /[.!?]["')\]]?\s*$/.test(String(text || "").trim());
}

// A speaker finishing a sentence trails off; one pausing mid-thought tends to stop abruptly at
// conversational volume. Null when there aren't enough samples to say — the text decides alone.
export function energyTrend(samples, { tail = 5, window = 15 } = {}) {
  if (!Array.isArray(samples) || samples.length < window) return null;
  const recent = samples.slice(-tail);
  const prior = samples.slice(-window, -tail);
  if (!recent.length || !prior.length) return null;
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const a = mean(prior);
  const b = mean(recent);
  if (a <= 0) return null;
  const ratio = b / a;
  if (ratio < 0.6) return "falling";
  if (ratio > 1.25) return "rising";
  return "flat";
}

// Returns { state, waitMs, reason }. `state` is "holding" | "ambiguous" | "complete".
// Every ambiguous case waits: ending early destroys evidence the candidate was mid-answer,
// while waiting too long merely feels slow.
export function classify(transcript, { energy, policy } = {}) {
  const p = normalizeEndpointing(policy);
  const text = String(transcript || "").trim();
  const wordCount = words(text).length;

  if (!text) return { state: "holding", waitMs: p.holdingWaitMs, reason: "nothing_said" };
  if (isHolding(text)) return { state: "holding", waitMs: p.holdingWaitMs, reason: "trails_mid_thought" };
  if (wordCount < p.minCompleteWords) {
    return { state: "ambiguous", waitMs: p.ambiguousWaitMs, reason: "too_short_to_be_sure" };
  }

  const trend = energyTrend(energy);
  if (hasTerminalPunctuation(text) && trend === "falling") {
    return { state: "complete", waitMs: p.completeWaitMs, reason: "sentence_end_falling_energy" };
  }
  if (hasTerminalPunctuation(text) && trend !== "rising") {
    return { state: "complete", waitMs: p.completeWaitMs, reason: "sentence_end" };
  }
  if (trend === "rising") return { state: "holding", waitMs: p.holdingWaitMs, reason: "energy_rising" };
  return { state: "ambiguous", waitMs: p.ambiguousWaitMs, reason: "no_sentence_end" };
}

// Mirror of backend/utils/finishIntent.js — the candidate saying outright that they are done.
// Honoured only as the tail of a substantive answer: "that's it" alone is far more likely to be
// a sentence still forming than a deliberate hand-back.
export function detectFinish(transcript, { triggers, minAnswerWords = 12, maxTrailingWords = 2 } = {}) {
  const list = Array.isArray(triggers) ? triggers.filter(Boolean) : [];
  if (!list.length) return { matched: false, honour: false };
  const text = String(transcript || "");

  let matchedTrigger = null;
  let lastIndex = -1;
  let matchLength = 0;

  for (const trigger of [...list].sort((a, b) => String(b).length - String(a).length)) {
    const w = String(trigger).toLowerCase().match(/[a-z0-9']+/g) || [];
    if (!w.length) continue;
    const re = new RegExp(`\\b${w.map((x) => x.replace(/'/g, "'?")).join("[^a-z0-9]+")}\\b[.,;:!?…]*`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index >= lastIndex) {
        lastIndex = m.index;
        matchedTrigger = trigger;
        matchLength = m[0].length;
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
    if (matchedTrigger) break;
  }

  if (!matchedTrigger) return { matched: false, honour: false };

  const before = words(text.slice(0, lastIndex)).length;
  const after = words(text.slice(lastIndex + matchLength)).length;
  return {
    matched: true,
    matchedTrigger,
    honour: before >= minAnswerWords && after <= maxTrailingWords,
  };
}
