// Lazy, same-origin loader for the in-browser face model (face-api.js).
//
// EVERYTHING here is optional and degrades silently: if the library bundle (/vendor/face-api.min.js)
// or the model weights (/models) aren't present, `ensureLoaded()` rejects, `isReady()` stays false,
// and the caller runs browser-signal proctoring only. The interview must never break because vision
// is unavailable.
//
// The model runs entirely in the candidate's browser — raw video never leaves the device. Only
// derived signals (face count, gaze, an identity *distance*) are sent to the server, which keeps
// candidate biometrics off our infrastructure (DPDP-friendly). To activate vision, drop the assets
// in with `node scripts/fetch-face-models.mjs` (see user/public/models/README.md).

const VENDOR_URL = "/vendor/face-api.min.js";
const MODEL_URL = "/models";

let loadPromise = null;
let faceapi = null;
let ready = false;
let recognitionLoaded = false;

function injectScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    if (window.faceapi) return resolve(window.faceapi);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.faceapi = "1";
    s.onload = () => (window.faceapi ? resolve(window.faceapi) : reject(new Error("face-api not on window")));
    s.onerror = () => reject(new Error("face-api bundle not found"));
    document.head.appendChild(s);
  });
}

// Idempotent: kicks off (and caches) the one-time library + model load.
export function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    faceapi = await injectScript(VENDOR_URL);
    if (!faceapi?.nets) throw new Error("face-api unavailable");
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    // Recognition weights are large (~6 MB) and only needed for identity match — if they're absent
    // the rest (presence, multi-face, gaze) still works, just without identity matching.
    try {
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      recognitionLoaded = true;
    } catch {
      recognitionLoaded = false;
    }
    ready = true;
    return true;
  })().catch((e) => {
    ready = false;
    throw e;
  });
  return loadPromise;
}

export function isReady() {
  return ready;
}

export function recognitionAvailable() {
  return recognitionLoaded;
}

const avg = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / pts.length;

// Rough head-pose "looking away" from the 68-point landmarks: horizontal offset of the nose tip
// from the eye midpoint (yaw), plus a downward offset (looking down). Heuristic, not gaze-tracking —
// tuned to catch a candidate clearly turned away, not normal micro-movements.
//
// The two axes are reported SEPARATELY rather than collapsed into one boolean, because they mean
// different things to a reviewer: "down" is a candidate reading something below the screen (notes,
// a phone, a keyboard), "side" is a second monitor or another person in the room. Merging them
// discards the only part of the signal that carries intent.
const YAW_AWAY = 0.16;
const PITCH_DOWN = 0.3;

function estimateGaze(landmarks, box) {
  try {
    const nose = landmarks.getNose();
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const noseTip = nose[Math.floor(nose.length / 2)] || nose[nose.length - 1];
    const eyeMidX = (avg(leftEye, "x") + avg(rightEye, "x")) / 2;
    const eyeMidY = (avg(leftEye, "y") + avg(rightEye, "y")) / 2;
    const dx = (noseTip.x - eyeMidX) / (box.width || 1);
    const dy = (noseTip.y - eyeMidY) / (box.height || 1);
    const side = Math.abs(dx) > YAW_AWAY;
    const down = dy > PITCH_DOWN;
    if (!side && !down) return { away: false, direction: null };
    // Both at once reads as "turned down and away" — report the stronger axis relative to its own
    // threshold so the label matches what dominated.
    if (side && down) {
      return { away: true, direction: Math.abs(dx) / YAW_AWAY >= dy / PITCH_DOWN ? "side" : "down" };
    }
    return { away: true, direction: side ? "side" : "down" };
  } catch {
    return { away: false, direction: null };
  }
}

// inputSize 224 was too lossy to be fair. face-api pads the frame to a square before resizing, so
// a 320x240 capture left roughly a 60px face for the detector to work with — enough that ordinary
// backlight, glasses glare, or a downward glance dropped it under threshold and the candidate was
// logged as ABSENT. 416 against a 640x480 capture (see useProctoring.js) roughly triples the pixels
// on the face. The cost is ~15-25ms more per tick in the candidate's browser and nothing at all on
// our infrastructure — a trade worth making many times over to stop accusing people of leaving.
const DETECTOR_INPUT_SIZE = 416;
// Kept at face-api's conventional 0.5 rather than the previous 0.45. The threshold is no longer
// doing the job of hiding a starved detector, so it doesn't need to be loosened.
const DETECTOR_SCORE_THRESHOLD = 0.5;

// Analyze one video/canvas frame. Returns null if not ready.
//   { faceCount, descriptor?, gazeAway, gazeDirection, faceBox, score, boxRatio, atEdge }
//
// `score` is the detector's OWN confidence in its best detection, and it is the reason this
// function exists in its current shape: without it the caller cannot distinguish "confidently
// nobody there" from "0.49, just missed" — and it was reporting both to the server as the
// candidate's absence. A measurement of the detector and a measurement of the candidate are
// different propositions; the caller needs both to keep them apart.
// `withDescriptor` gates the face-RECOGNITION net, which is by far the most expensive stage here
// (a ~6MB model, tens of ms per call). Presence, multi-face and gaze need only the detector and the
// landmarks, so at a 1s tick the recognition pass runs on identity-sample ticks only — otherwise
// the proctor would spend most of a candidate's CPU re-answering a question that changes slowly.
export async function analyzeFrame(input, { withDescriptor = false } = {}) {
  if (!ready || !faceapi) return null;
  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: DETECTOR_INPUT_SIZE,
    scoreThreshold: DETECTOR_SCORE_THRESHOLD,
  });
  let chain = faceapi.detectAllFaces(input, opts).withFaceLandmarks();
  if (recognitionLoaded && withDescriptor) chain = chain.withFaceDescriptors();
  const results = await chain;

  const faceCount = results.length;
  let descriptor;
  let gazeAway = false;
  let gazeDirection = null;
  let faceBox;
  let score = 0;
  let boxRatio = 0;
  let atEdge = false;
  if (faceCount >= 1) {
    const main = results.reduce((a, b) => (a.detection.box.area > b.detection.box.area ? a : b));
    descriptor = main.descriptor ? Array.from(main.descriptor) : undefined;
    const gaze = estimateGaze(main.landmarks, main.detection.box);
    gazeAway = gaze.away;
    gazeDirection = gaze.direction;
    const box = main.detection.box;
    faceBox = { x: box.x, y: box.y, width: box.width, height: box.height };
    score = Math.round((main.detection.score || 0) * 100) / 100;
    // How much of the frame the face fills, and whether it is running off an edge. Both are
    // ordinary framing facts a reviewer needs in order to read a flag correctly — a face at 2%
    // of frame that "disappears" is a candidate sitting too far back, not a candidate leaving.
    const w = input.videoWidth || input.width || 0;
    const h = input.videoHeight || input.height || 0;
    if (w && h) {
      boxRatio = Math.round(((box.width * box.height) / (w * h)) * 1000) / 1000;
      const m = 4; // px tolerance
      atEdge = box.x <= m || box.y <= m || box.x + box.width >= w - m || box.y + box.height >= h - m;
    }
  }
  return { faceCount, descriptor, gazeAway, gazeDirection, faceBox, score, boxRatio, atEdge };
}

// Euclidean distance between two face descriptors (lower = more likely the same person). ~<0.6 is
// the conventional "same face" threshold for face-api's 128-d descriptors.
export function descriptorDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.round(Math.sqrt(sum) * 1000) / 1000;
}
