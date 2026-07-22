// One-time fetch of the in-browser face model assets for interview proctoring (Tier 2 vision).
//
//   node scripts/fetch-face-models.mjs
//
// Downloads the face-api.js browser bundle → public/vendor/face-api.min.js and the model weights
// → public/models/. Until these exist, proctoring runs Tier 1 (browser signals) only; once present,
// face presence / multi-face / gaze / identity-match light up automatically (see
// src/portal/faceVision.js). Everything is served from our own origin — no CDN at runtime, no
// candidate video ever leaves the browser (DPDP-friendly).
//
// Pinned to face-api.js@0.22.2 (self-contained bundle, includes its own TensorFlow.js). The weight
// files are the canonical ones from the face-api.js repo.

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "public");

const BUNDLE_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const WEIGHTS_BASE = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";

const WEIGHT_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model-shard1",
  "face_recognition_model-shard2",
];

// GET with redirect following (jsdelivr / raw.githubusercontent both redirect).
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects for ${url}`));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`${res.statusCode} for ${url}`));
        }
        mkdirSync(dirname(dest), { recursive: true });
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  console.log("Fetching face-api bundle …");
  await download(BUNDLE_URL, join(PUBLIC, "vendor", "face-api.min.js"));
  console.log("  ✓ public/vendor/face-api.min.js");

  for (const name of WEIGHT_FILES) {
    process.stdout.write(`Fetching ${name} … `);
    await download(`${WEIGHTS_BASE}/${name}`, join(PUBLIC, "models", name));
    console.log("✓");
  }
  console.log("\nDone. Restart the dev server; the interview will now run in-browser face detection.");
}

main().catch((err) => {
  console.error("\nFetch failed:", err.message);
  console.error("Proctoring will keep working in Tier 1 (browser-signal) mode without these assets.");
  process.exit(1);
});
