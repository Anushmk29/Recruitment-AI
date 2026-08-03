// Mirror of backend/utils/echoAlignment.js — is that the candidate, or is it us hearing ourselves?
//
// Duplicated across the boundary for the same reason endpointing.js is: the decision has to be
// made here because only the browser knows, in real time, what is currently coming out of the
// speaker and how far through it is. The THRESHOLDS are not duplicated — minNovelRun, minEchoRun
// and lookaheadRatio arrive from the server with the streaming credential (policy.echo), so a
// tenant's interview conditions stay configured in one place. Only the classification runs here.
//
// See the backend file for the full reasoning. The short version:
//
//   - The interviewer keeps its microphone open while it speaks, so it can be interrupted. On a
//     laptop with no headphones that microphone hears the interviewer, and the transcription
//     provider returns our own words as text.
//   - We know exactly what we are saying, so echo is not an unknown signal to filter — it is a
//     known string coming back slightly mangled. Strike out everything our own speech accounts
//     for; if a run of words is left that we did not say, that is a person.
//   - Ambiguity resolves to ECHO. Cutting a question off mid-delivery means it does not count as
//     having been asked (the server records it as not fully delivered), which corrupts evidence.
//     Talking over the candidate for a second longer is only rude — and their audio is still being
//     captured throughout, because the microphone never closed.
//
// This is what replaced the old rule, which armed barge-in only on devices where a pre-check tone
// measured that the microphone could not hear the speakers. That rule was correct and left most
// candidates — everyone without headphones — unable to interrupt at all.

const DEFAULTS = {
  minNovelRun: 3,
  minEchoRun: 2,
  lookaheadRatio: 0.15,
};

function tokenise(text) {
  return (
    String(text == null ? "" : text)
      .toLowerCase()
      .replace(/['']/g, "")
      .match(/[a-z0-9]+/g) || []
  );
}

// Longest common contiguous run. Contiguity is the point: echo reproduces a slice of our sentence
// in order, whereas a candidate reusing our vocabulary scatters those words through their own.
function longestCommonRun(a, b) {
  if (!a.length || !b.length) return { length: 0, aStart: -1, bStart: -1 };
  let best = { length: 0, aStart: -1, bStart: -1 };
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      row[j] = prev[j - 1] + 1;
      if (row[j] > best.length) best = { length: row[j], aStart: i - row[j], bStart: j - row[j] };
    }
    prev = row;
  }
  return best;
}

// Repeatedly attribute the longest shared stretch to echo. Longest-first so a long verbatim run is
// claimed before a short incidental collision — one shared word is a coincidence, eight in a row
// is our sentence. Consuming from `pool` stops one stretch of our speech explaining two separate
// parts of the transcript.
function explainedMask(transcriptTokens, spokenTokens, minRunWords) {
  const mask = new Array(transcriptTokens.length).fill(false);
  const pool = [...spokenTokens];
  const src = [...transcriptTokens];
  for (;;) {
    const run = longestCommonRun(src, pool);
    if (run.length < minRunWords) break;
    for (let k = 0; k < run.length; k++) {
      mask[run.aStart + k] = true;
      src[run.aStart + k] = " ";
      pool[run.bStart + k] = "";
    }
  }
  return mask;
}

function longestUnexplainedRun(mask) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      run = 0;
      continue;
    }
    run += 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Was that our own voice, or the candidate's?
 *
 * @param {string} transcript          what the provider just returned
 * @param {object} opts
 *   @param {string} opts.spokenText   the text currently being spoken (empty when we are silent)
 *   @param {number} [opts.spokenRatio] 0-1, how far through it playback is
 *   @param {object} [opts.policy]     server-supplied thresholds (policy.echo)
 *
 * @returns {{verdict: "echo"|"speech", residue: string, novelRun: number}}
 *
 * `residue` is the transcript with our own words struck out — the candidate's actual first words,
 * so a barge-in starts their turn with what they really said rather than with the tail of our
 * question.
 */
export function classifyEcho(transcript, { spokenText = "", spokenRatio, policy } = {}) {
  const p = { ...DEFAULTS, ...(policy || {}) };
  const tTokens = tokenise(transcript);
  if (!tTokens.length) return { verdict: "echo", residue: "", novelRun: 0 };

  let sTokens = tokenise(spokenText);
  // Nothing of ours is playing, so nothing of ours can be coming back. The ordinary listening case.
  if (!sTokens.length) {
    return { verdict: "speech", residue: String(transcript || "").trim(), novelRun: tTokens.length };
  }

  if (Number.isFinite(spokenRatio)) {
    const bound = Math.min(1, Math.max(0, spokenRatio) + p.lookaheadRatio);
    // Never narrow to nothing: at the very start of playback a transcript is still far more likely
    // to be our first word echoing than a coincidence.
    sTokens = sTokens.slice(0, Math.max(1, Math.ceil(sTokens.length * bound)));
  }

  const mask = explainedMask(tTokens, sTokens, p.minEchoRun);
  const novelRun = longestUnexplainedRun(mask);
  const residue = tTokens.filter((_, i) => !mask[i]).join(" ");

  return {
    verdict: novelRun >= p.minNovelRun ? "speech" : "echo",
    residue,
    novelRun,
  };
}

export { DEFAULTS as ECHO_DEFAULTS };
