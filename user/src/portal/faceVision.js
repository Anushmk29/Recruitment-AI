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
function estimateGazeAway(landmarks, box) {
  try {
    const nose = landmarks.getNose();
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const noseTip = nose[Math.floor(nose.length / 2)] || nose[nose.length - 1];
    const eyeMidX = (avg(leftEye, "x") + avg(rightEye, "x")) / 2;
    const eyeMidY = (avg(leftEye, "y") + avg(rightEye, "y")) / 2;
    const dx = (noseTip.x - eyeMidX) / (box.width || 1);
    const dy = (noseTip.y - eyeMidY) / (box.height || 1);
    return Math.abs(dx) > 0.16 || dy > 0.3;
  } catch {
    return false;
  }
}

// Analyze one video/canvas frame → { faceCount, descriptor?, gazeAway }. Returns null if not ready.
export async function analyzeFrame(input) {
  if (!ready || !faceapi) return null;
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
  let chain = faceapi.detectAllFaces(input, opts).withFaceLandmarks();
  if (recognitionLoaded) chain = chain.withFaceDescriptors();
  const results = await chain;

  const faceCount = results.length;
  let descriptor;
  let gazeAway = false;
  let faceBox;
  if (faceCount >= 1) {
    const main = results.reduce((a, b) => (a.detection.box.area > b.detection.box.area ? a : b));
    descriptor = main.descriptor ? Array.from(main.descriptor) : undefined;
    gazeAway = estimateGazeAway(main.landmarks, main.detection.box);
    const box = main.detection.box;
    faceBox = { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  return { faceCount, descriptor, gazeAway, faceBox };
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
