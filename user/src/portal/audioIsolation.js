// Does this candidate's microphone hear their own speakers?
//
// This is the prerequisite for letting the interviewer keep listening while it talks. If the mic
// picks up the interviewer's voice, "the candidate started speaking" and "the interviewer is
// speaking" become indistinguishable, and the interviewer interrupts itself mid-question.
//
// Why measure instead of checking device labels: enumerateDevices() labels are inconsistent across
// browsers, often empty without permission, and say nothing about whether echo cancellation is
// actually working on this hardware. Playing a tone and listening for it measures the echo path
// that really exists, AFTER the browser's AEC — which is the only thing that matters. A candidate
// on laptop speakers whose browser cancels the echo well should get interruption; one on
// headphones with a broken driver should not.
//
// This is diagnostic, never a gate. A candidate with no headphones gets the turn-based interview —
// the same interview everyone got before this existed. Blocking them would be a fairness problem
// wearing a quality bar's clothes.

// Shared so the pre-check measures the exact pipeline the interview will run. Echo cancellation is
// requested explicitly rather than left to the browser default: the default is usually on, but
// "usually" is not a basis for deciding whether the interviewer may listen while it speaks.
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

const TONE_HZ = 1000; // squarely inside speech band and inside every AEC's working range
const BASELINE_MS = 350;
const TONE_MS = 600;
const SAMPLE_MS = 25;

// Ratio of mic level during the tone to the room's own baseline. Above this, the output is clearly
// reaching the mic. Paired with an absolute floor because a noisy room inflates the baseline and
// would otherwise hide a real echo path behind a small ratio.
const BLEED_RATIO = 2.5;
const BLEED_ABSOLUTE = 0.01;

function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function unsupported(reason) {
  return { verdict: "inconclusive", ratio: null, baseline: null, tone: null, reason };
}

// Measure for `ms`, returning the PEAK rms seen. Peak rather than mean: echo arrives as a burst and
// an average over a window that includes silence would dilute it below the threshold.
function samplePeak(analyser, ms) {
  return new Promise((resolve) => {
    const frame = new Float32Array(analyser.fftSize);
    let peak = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(frame);
      peak = Math.max(peak, rms(frame));
    }, SAMPLE_MS);
    setTimeout(() => {
      clearInterval(timer);
      resolve(peak);
    }, ms);
  });
}

// Returns { verdict: "isolated" | "bleeding" | "inconclusive", ratio, baseline, tone, reason }.
// Always resolves — an unmeasurable device is "inconclusive", never an exception the caller has to
// handle to keep the check page working.
export async function measureAudioIsolation() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return unsupported("unsupported-browser");
  }
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctx) return unsupported("no-audio-context");

  let stream = null;
  let ctx = null;
  try {
    // The SAME constraints the interview itself uses, so what we measure is what will happen live.
    stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS.audio });
    ctx = new Ctx();
    // Autoplay policy: this runs from a click on the check page, so resume() succeeds — but a
    // suspended context would silently measure a tone nobody played, so refuse rather than lie.
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return unsupported("audio-context-blocked");

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const baseline = await samplePeak(analyser, BASELINE_MS);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = TONE_HZ;
    // Audible but not startling — this plays into a candidate's ears without warning.
    gain.gain.value = 0.18;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const tone = await samplePeak(analyser, TONE_MS);
    osc.stop();
    osc.disconnect();
    gain.disconnect();

    const ratio = baseline > 0 ? tone / baseline : null;
    const bleeding = tone >= BLEED_ABSOLUTE && (ratio === null || ratio >= BLEED_RATIO);
    return {
      verdict: bleeding ? "bleeding" : "isolated",
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      baseline: Math.round(baseline * 1e4) / 1e4,
      tone: Math.round(tone * 1e4) / 1e4,
      reason: null,
    };
  } catch (err) {
    return unsupported(err?.name || "measurement-failed");
  } finally {
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    try {
      if (ctx && ctx.state !== "closed") await ctx.close();
    } catch { /* ignore */ }
  }
}
