# Face model assets (interview proctoring — Tier 2 vision)

This folder holds the in-browser face-detection model weights used for interview proctoring
(face presence, multi-face, gaze, and identity match). It is **empty by default** — proctoring
still works without it, running **Tier 1** (browser signals: tab-switch, fullscreen-exit,
copy/paste, camera-loss). Adding the weights here turns on **Tier 2** vision automatically.

## Install (one command)

From the `user/` directory:

```bash
npm run fetch:face-models
```

That downloads:

- `../vendor/face-api.min.js` — the self-contained face-api.js bundle (includes its own
  TensorFlow.js). Loaded from our own origin at runtime — no CDN in production.
- the model weight files into this folder:
  - `tiny_face_detector_model-*` — face detection (presence + multi-face)
  - `face_landmark_68_model-*` — landmarks (gaze / head-pose heuristic)
  - `face_recognition_model-*` — 128-d descriptors (identity match vs. the pre-check photo)

Then restart the dev server.

## Why self-hosted

Everything runs in the candidate's browser; only derived integrity signals (a face count, a
gaze flag, an identity *distance*) are sent to the server — never the raw camera frames. Serving
the model from our own origin (not a CDN) keeps candidate biometrics off third-party infra, which
is the posture we want for India DPDP. See `src/portal/faceVision.js`.

## Graceful degradation

If these files are missing (or only the detector/landmark weights are present but not
recognition), the interview never breaks: it drops to the highest tier it can support and records
`visionEnabled: false` (or omits identity match) on the report accordingly.
