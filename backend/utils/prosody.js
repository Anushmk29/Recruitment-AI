// Deterministic delivery/confidence scoring from a spoken answer's acoustic measurements.
//
// The LLM judges answer *content* from the transcript — but it can't hear the candidate, so
// tone/confidence/delivery must come from measurements, not the model. These are heuristic,
// indicative signals (a nervous candidate can still be a strong hire), scored server-side so a
// client can't forge the score. Inputs are the raw, clamped measurements the browser computes:
//   wordsPerMinute, fillerRate (per 100 words), pauseRatio (0-1), energyVariance.

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Pace + steadiness of speech. Comfortable conversational pace is ~110-170 wpm; very slow reads
// as hesitant, very fast as rushed. Heavy silence also drags it down.
function scoreDelivery(a) {
  if (!a || typeof a !== "object") return undefined;
  let s = 100;
  if (a.wordsPerMinute != null) {
    const w = a.wordsPerMinute;
    if (w < 90) s -= (90 - w) * 0.6;
    else if (w > 190) s -= (w - 190) * 0.5;
  }
  if (a.pauseRatio != null) s -= Math.max(0, a.pauseRatio - 0.35) * 120;
  if (a.fillerRate != null) s -= a.fillerRate * 1.5;
  const out = Math.round(clamp(s, 0, 100));
  return Number.isFinite(out) ? out : undefined;
}

// Confidence proxy: fluent, low-filler, low-hesitation speech at a steady pace reads as confident.
function scoreConfidence(a) {
  if (!a || typeof a !== "object") return undefined;
  let s = 100;
  if (a.fillerRate != null) s -= a.fillerRate * 4; // ~5 fillers/100 words → -20
  if (a.pauseRatio != null) s -= Math.max(0, a.pauseRatio - 0.3) * 110;
  if (a.wordsPerMinute != null && a.wordsPerMinute < 80) s -= (80 - a.wordsPerMinute) * 0.5;
  const out = Math.round(clamp(s, 0, 100));
  return Number.isFinite(out) ? out : undefined;
}

// Mean of defined numbers, or undefined if none.
function mean(nums) {
  const vals = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!vals.length) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// Aggregate delivery + confidence across all spoken candidate turns of an interview.
function aggregateVoiceScores(turns) {
  const spoken = (turns || []).filter((t) => t.role === "candidate" && t.inputMode === "voice" && t.acoustic);
  if (!spoken.length) return null;
  const delivery = mean(spoken.map((t) => t.acoustic.deliveryScore ?? scoreDelivery(t.acoustic)));
  const confidence = mean(spoken.map((t) => scoreConfidence(t.acoustic)));
  return { delivery, confidence, spokenAnswers: spoken.length };
}

module.exports = { scoreDelivery, scoreConfidence, aggregateVoiceScores };
