import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client.js";
import { authHeader } from "./portalAuth.js";
import * as faceVision from "./faceVision.js";

// Client-side proctoring engine for the interview room.
//
// Tier 1 — browser signals (no ML, always on): tab-switch, window-blur, fullscreen-exit,
//   copy/paste, right-click, camera-loss. Pure DOM events.
// Tier 2 — in-browser vision (optional, only if the face model assets are present): face presence,
//   multi-face, gaze-away, and identity match against the pre-check photo.
//
// The browser is an untrusted reporter — it sends only event TYPES; the server assigns severity and
// computes the risk score (backend utils/proctoring.js). Events are buffered and flushed in batches
// to POST /interview-portal/proctoring/events. Enforcement is "warn live": each event fires an
// onWarn(message) the room surfaces; it never blocks or ends the interview.

const FLUSH_MS = 5000; // batch-flush interval
const VISION_MS = 2500; // face-analysis interval

// --- Evidence clips (Phase 14.2) ---
// The recorder is rotated every EVIDENCE_SEGMENT_MS so there is always a valid,
// self-contained WebM covering the recent past (a chunk ring can't be replayed
// without its header chunk). When a qualifying event fires, the current segment
// is finalised and uploaded: up to ~15s of context ending at the event moment.
// Everything is advisory client-side — the server re-enforces consent, type,
// size, magic bytes, and the per-session cap.
const EVIDENCE_SEGMENT_MS = 15000;
const EVIDENCE_MAX_UPLOADS = 6; // advisory mirror of the server cap
const EVIDENCE_COOLDOWN_MS = 45000; // per event type
const FACE_ABSENT_SUSTAINED_TICKS = 3; // ~7.5s of continuous no-face before a clip

// Attention-pattern clips (behavioral escalation, not a single high-severity event): the face is
// blurred, since a reviewer only needs body-language/context here, not identity. Rendered on an
// offscreen canvas so the identity-critical pipeline (multi_face/identity_mismatch/face_absent/
// phone_cam_lost — reviewer needs the actual face to verify those) stays on the raw stream, untouched.
const BLUR_EVENT_TYPES = new Set(["attention_pattern"]);
const BLUR_DRAW_MS = 150; // ~7fps canvas draw cadence — cheap at 320x240
const BLUR_STREAM_FPS = 8;
const FACE_BOX_PAD = 1.6; // expand the last known face box 60% to tolerate movement between vision ticks
const FACE_BOX_STALE_MS = 5000; // beyond this (≈2x VISION_MS), fall back to a generous default region

// A pile of routine ambient signals (not any single high-severity event) still deserves one
// reviewable moment once it crosses a real pattern — same "disagreement is a routing signal"
// philosophy applied to behavior instead of claims. One clip per escalation window, not one per warning.
const AMBIENT_NOISE_TYPES = new Set(["tab_switch", "window_blur", "gaze_away", "context_menu"]);
const AMBIENT_NOISE_THRESHOLD = 5;

// Debounce so one sustained condition (e.g. the candidate steps away) isn't logged every tick.
const DEDUPE_MS = { face_absent: 5000, multi_face: 5000, gaze_away: 7000, window_blur: 1500 };

// Calm, non-accusatory nudges — the goal is to steer back on track, not to threaten.
const WARN = {
  tab_switch: "Please stay on the interview tab.",
  window_blur: "Please keep the interview window focused.",
  fullscreen_exit: "You've left fullscreen — please return to it to continue.",
  copy: "Copying is disabled during this interview.",
  paste: "Pasting is disabled during this interview — please answer in your own words.",
  face_absent: "We can't see you clearly — please stay in front of the camera.",
  multi_face: "More than one person was detected on camera.",
  gaze_away: "Please keep your attention on the screen.",
  identity_mismatch: "The camera doesn't appear to match your identity photo.",
  camera_lost: "Your camera turned off — please re-enable it to continue.",
};

// Generic segment-rotate-upload state machine, instantiated once per stream source (raw camera /
// blurred canvas). `shared` is the SAME object across both instances so the per-session upload cap
// is enforced across both pipelines combined, matching the server's per-session (not per-source) cap.
function createClipPipeline({ getStream, uploadClip, shared, maxUploads, cooldownMs, segmentMs }) {
  const st = {
    active: false,
    recorder: null,
    chunks: [],
    segmentStartedAt: 0,
    rotateTimer: null,
    pendingEvent: null,
    lastCaptureAt: {},
  };

  function startSegment() {
    const stream = getStream();
    if (!st.active || !stream) return;
    let recorder;
    try {
      const mime = window.MediaRecorder?.isTypeSupported?.("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 400000 });
    } catch {
      st.active = false; // recorder unsupported → this pipeline just never starts
      return;
    }
    st.chunks = [];
    st.segmentStartedAt = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) st.chunks.push(e.data);
    };
    recorder.onstop = () => {
      const pending = st.pendingEvent;
      st.pendingEvent = null;
      if (pending && st.chunks.length) {
        const blob = new Blob(st.chunks, { type: "video/webm" });
        // ~6MB server cap; skip rather than fail loudly if a segment overshoots.
        if (blob.size > 1000 && blob.size <= 6 * 1024 * 1024) {
          uploadClip(blob, pending.eventType, Date.now() - st.segmentStartedAt);
        }
      }
      st.chunks = [];
      if (st.active) startSegment(); // rotate into a fresh segment
    };
    recorder.start(1000);
    st.recorder = recorder;
  }

  return {
    start() {
      if (st.active || !window.MediaRecorder || !getStream()) return;
      st.active = true;
      startSegment();
      st.rotateTimer = setInterval(() => {
        if (st.active && st.recorder && st.recorder.state === "recording" && !st.pendingEvent) {
          try {
            st.recorder.stop(); // onstop discards + restarts → fresh segment
          } catch {
            // ignore
          }
        }
      }, segmentMs);
    },
    stop() {
      st.active = false;
      if (st.rotateTimer) clearInterval(st.rotateTimer);
      st.rotateTimer = null;
      st.pendingEvent = null;
      try {
        if (st.recorder && st.recorder.state !== "inactive") st.recorder.stop();
      } catch {
        // already stopped
      }
      st.recorder = null;
      st.chunks = [];
    },
    // Finalise the current segment and ship it as evidence for `eventType`.
    capture(eventType) {
      if (!st.active || !st.recorder || st.recorder.state !== "recording" || st.pendingEvent) return;
      if (shared.uploads >= maxUploads) return;
      const now = Date.now();
      if (now - (st.lastCaptureAt[eventType] || 0) < cooldownMs) return;
      st.lastCaptureAt[eventType] = now;
      st.pendingEvent = { eventType, at: now };
      try {
        st.recorder.stop(); // onstop uploads this segment, then rotates
      } catch {
        st.pendingEvent = null;
      }
    },
  };
}

// Expand a detected face box by FACE_BOX_PAD (centered), clamped to the canvas bounds.
function padBox(box, canvasW, canvasH) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const w = box.width * FACE_BOX_PAD;
  const h = box.height * FACE_BOX_PAD;
  const sx = Math.max(0, Math.round(cx - w / 2));
  const sy = Math.max(0, Math.round(cy - h / 2));
  return {
    sx,
    sy,
    sw: Math.min(canvasW - sx, Math.round(w)),
    sh: Math.min(canvasH - sy, Math.round(h)),
  };
}

// No recent face box (vision hasn't run yet, or the model isn't installed) — err toward more
// blur, not less: cover a generous centered upper region where a face would typically be.
function fallbackBlurRect(canvasW, canvasH) {
  const w = canvasW * 0.7;
  const h = canvasH * 0.7;
  return { sx: Math.round((canvasW - w) / 2), sy: Math.round(canvasH * 0.05), sw: Math.round(w), sh: Math.round(h) };
}

export function useProctoring({ enabled = true, onWarn, referenceDescriptor, evidence } = {}) {
  const [riskScore, setRiskScore] = useState(0);
  const [visionOn, setVisionOn] = useState(false);
  const [monitoring, setMonitoring] = useState(false);

  const videoRef = useRef(null); // self-view element (the room renders it)
  const streamRef = useRef(null);
  const queueRef = useRef([]);
  const lastFiredRef = useRef({});
  const flushTimerRef = useRef(null);
  const visionTimerRef = useRef(null);
  const identityDoneRef = useRef(false);
  const visionOnRef = useRef(false);
  const runningRef = useRef(false);
  const cleanupRef = useRef(null); // removes the Tier-1 DOM listeners
  const ambientCountRef = useRef(0);

  const warnRef = useRef(onWarn);
  useEffect(() => { warnRef.current = onWarn; }, [onWarn]);
  const refDescRef = useRef(referenceDescriptor);
  useEffect(() => { refDescRef.current = referenceDescriptor; }, [referenceDescriptor]);

  // Evidence buffer state (Phase 14.2/14.7). No consent → the buffers NEVER start; there is nothing
  // to "not upload" because nothing is ever held. `uploads` is shared across BOTH pipelines below so
  // the per-session cap is enforced across their combined total, matching the server's per-session cap.
  const evidenceRef = useRef({ uploads: 0, faceAbsentStreak: 0 });
  const evidenceOptRef = useRef(evidence);
  useEffect(() => { evidenceOptRef.current = evidence; }, [evidence]);

  const rawPipelineRef = useRef(null); // identity-critical events — unblurred raw camera stream
  const blurPipelineRef = useRef(null); // attention_pattern only — blurred canvas stream
  const blurCanvasRef = useRef(null);
  const blurCtxRef = useRef(null);
  const blurStreamRef = useRef(null);
  const blurDrawTimerRef = useRef(null);
  const lastFaceBoxRef = useRef({ box: null, at: 0 });

  const uploadClip = useCallback(async (blob, eventType, durationMs) => {
    try {
      const form = new FormData();
      form.append("clip", blob, "clip.webm");
      form.append("eventType", eventType);
      form.append("durationMs", String(Math.round(durationMs)));
      await api.post("/interview-portal/proctoring/evidence", form, { headers: authHeader() });
      evidenceRef.current.uploads += 1;
    } catch {
      // A failed upload degrades silently to counts-only behaviour — clip
      // capture must never block or disturb the interview.
    }
  }, []);

  // Blurred canvas source (attention_pattern pipeline only). Never attached to the DOM — it exists
  // purely to give a MediaRecorder a blurred-face stream to record from.
  const drawBlurredFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = blurCanvasRef.current;
    const ctx = blurCtxRef.current;
    if (!video || !canvas || !ctx || video.readyState < 2 || video.videoWidth === 0) return;
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.filter = "none";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // full frame, sharp base

    const { box, at } = lastFaceBoxRef.current;
    const fresh = box && Date.now() - at < FACE_BOX_STALE_MS;
    const r = fresh ? padBox(box, canvas.width, canvas.height) : fallbackBlurRect(canvas.width, canvas.height);

    ctx.save();
    ctx.filter = "blur(16px)";
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, r.sx, r.sy, r.sw, r.sh); // redraw just that region, blurred
    ctx.restore();
  }, []);

  const stopBlurCanvas = useCallback(() => {
    if (blurDrawTimerRef.current) clearInterval(blurDrawTimerRef.current);
    blurDrawTimerRef.current = null;
    blurStreamRef.current?.getTracks().forEach((t) => t.stop());
    blurStreamRef.current = null;
  }, []);

  const startBlurCanvas = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!blurCanvasRef.current) {
      blurCanvasRef.current = document.createElement("canvas");
      blurCanvasRef.current.width = video.videoWidth || 320;
      blurCanvasRef.current.height = video.videoHeight || 240;
      blurCtxRef.current = blurCanvasRef.current.getContext("2d");
    }
    try {
      blurStreamRef.current = blurCanvasRef.current.captureStream(BLUR_STREAM_FPS);
    } catch {
      blurStreamRef.current = null; // captureStream unsupported → blur pipeline just never gets a source
      return;
    }
    blurDrawTimerRef.current = setInterval(drawBlurredFrame, BLUR_DRAW_MS);
  }, [drawBlurredFrame]);

  const stopEvidence = useCallback(() => {
    rawPipelineRef.current?.stop();
    blurPipelineRef.current?.stop();
    stopBlurCanvas();
  }, [stopBlurCanvas]);

  const startEvidence = useCallback(() => {
    const opt = evidenceOptRef.current;
    if (!opt?.enabled || !opt?.consented) return; // no consent → no buffer, ever
    if (!window.MediaRecorder) return;
    if (!rawPipelineRef.current) {
      rawPipelineRef.current = createClipPipeline({
        getStream: () => streamRef.current,
        uploadClip,
        shared: evidenceRef.current,
        maxUploads: EVIDENCE_MAX_UPLOADS,
        cooldownMs: EVIDENCE_COOLDOWN_MS,
        segmentMs: EVIDENCE_SEGMENT_MS,
      });
    }
    if (!blurPipelineRef.current) {
      blurPipelineRef.current = createClipPipeline({
        getStream: () => blurStreamRef.current,
        uploadClip,
        shared: evidenceRef.current,
        maxUploads: EVIDENCE_MAX_UPLOADS,
        cooldownMs: EVIDENCE_COOLDOWN_MS,
        segmentMs: EVIDENCE_SEGMENT_MS,
      });
    }
    startBlurCanvas();
    rawPipelineRef.current.start();
    blurPipelineRef.current.start();
  }, [uploadClip, startBlurCanvas]);

  // Finalise the current segment on the appropriate pipeline (raw for identity-critical events,
  // blurred for attention_pattern) and ship it as evidence for `eventType`.
  const captureEvidence = useCallback((eventType) => {
    const pipeline = BLUR_EVENT_TYPES.has(eventType) ? blurPipelineRef.current : rawPipelineRef.current;
    pipeline?.capture(eventType);
  }, []);

  // Buffer an event (server owns severity/score). Deduped per-type; optionally warns the candidate.
  const record = useCallback((type, meta, { warn = true } = {}) => {
    const now = Date.now();
    const gap = DEDUPE_MS[type];
    if (gap && now - (lastFiredRef.current[type] || 0) < gap) return;
    lastFiredRef.current[type] = now;
    queueRef.current.push(meta ? { type, meta } : { type });
    if (AMBIENT_NOISE_TYPES.has(type)) {
      ambientCountRef.current += 1;
      if (ambientCountRef.current >= AMBIENT_NOISE_THRESHOLD) captureEvidence("attention_pattern");
    }
    if (warn && WARN[type]) warnRef.current?.(WARN[type]);
  }, [captureEvidence]);

  const flush = useCallback(async (extra) => {
    const events = queueRef.current;
    queueRef.current = [];
    if (!events.length && !extra) return;
    try {
      const { data } = await api.post(
        "/interview-portal/proctoring/events",
        { events, visionEnabled: visionOnRef.current, ...(extra || {}) },
        { headers: authHeader() }
      );
      if (typeof data?.riskScore === "number") setRiskScore(data.riskScore);
    } catch {
      // Telemetry must never sink the interview — requeue and retry on the next tick.
      queueRef.current = [...events, ...queueRef.current];
    }
  }, []);

  // --- Tier 2 vision loop ---
  const runVisionTick = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    let res;
    try {
      res = await faceVision.analyzeFrame(video);
    } catch {
      return;
    }
    if (!res) return;
    if (res.faceBox) lastFaceBoxRef.current = { box: res.faceBox, at: Date.now() };

    const ev = evidenceRef.current;
    if (res.faceCount === 0) {
      record("face_absent");
      // "Sustained" face-absent: only a continuous streak justifies a clip —
      // a single glance-away tick never persists video.
      ev.faceAbsentStreak += 1;
      if (ev.faceAbsentStreak >= FACE_ABSENT_SUSTAINED_TICKS) {
        captureEvidence("face_absent");
        ev.faceAbsentStreak = 0;
      }
    } else {
      ev.faceAbsentStreak = 0;
      if (res.faceCount > 1) {
        record("multi_face", { faceCount: res.faceCount });
        captureEvidence("multi_face");
      } else if (res.gazeAway) record("gaze_away");
    }

    // Identity match: one-shot, on the first clean single-face frame with a descriptor.
    if (!identityDoneRef.current && res.faceCount === 1 && res.descriptor && refDescRef.current) {
      const distance = faceVision.descriptorDistance(res.descriptor, refDescRef.current);
      if (distance != null) {
        identityDoneRef.current = true;
        const matched = distance < 0.6;
        if (!matched) {
          warnRef.current?.(WARN.identity_mismatch);
          captureEvidence("identity_mismatch");
        }
        flush({ identityMatch: { matched, distance } });
      }
    }
  }, [record, flush, captureEvidence]);

  const startVision = useCallback(async () => {
    if (!enabled) return;
    try {
      await faceVision.ensureLoaded();
    } catch {
      return; // assets absent → stay on Tier 1 only
    }
    visionOnRef.current = true;
    setVisionOn(true);
    visionTimerRef.current = setInterval(runVisionTick, VISION_MS);
  }, [enabled, runVisionTick]);

  // --- Start / stop ---
  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setMonitoring(true);

    // Tier 1 DOM listeners.
    const onVisibility = () => { if (document.hidden) record("tab_switch"); };
    const onBlur = () => {
      // A tab switch already fires visibilitychange; don't double-count as a window blur.
      if (Date.now() - (lastFiredRef.current.tab_switch || 0) < 900) return;
      record("window_blur");
    };
    const onFullscreen = () => { if (!document.fullscreenElement) record("fullscreen_exit"); };
    // copy/cut/paste are cancelable ClipboardEvents that fire regardless of keyboard shortcut vs.
    // right-click vs. Edit menu — preventDefault() here actually blocks the clipboard action, not
    // just logs it. Esc/fullscreen-exit below is NOT blockable this way (see onFullscreen) — no web
    // page in any browser can intercept Esc during fullscreen; that's an intentional browser
    // security boundary so a page can never trap a user in fullscreen.
    const onCopy = (e) => { e.preventDefault(); record("copy"); };
    const onCut = (e) => { e.preventDefault(); record("copy"); }; // cut ~= copy+delete; reuse the "copy" signal
    const onPaste = (e) => { e.preventDefault(); record("paste"); };
    const onContextMenu = () => record("context_menu", null, { warn: false });

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);
    cleanupRef.current = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
    };

    // Camera (video-only — the voice hook manages the mic separately). Permission was already
    // granted at pre-check, so this shouldn't re-prompt.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => record("camera_lost"));
      await startVision();
      startEvidence(); // no-op unless enabled + consented (Phase 14.2)
    } catch {
      // No camera → Tier 1 still runs; vision simply stays off.
    }

    flushTimerRef.current = setInterval(() => flush(), FLUSH_MS);
  }, [record, flush, startVision, startEvidence]);

  const stop = useCallback(async () => {
    if (!runningRef.current) return;
    runningRef.current = false;
    if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    if (visionTimerRef.current) clearInterval(visionTimerRef.current);
    flushTimerRef.current = null;
    visionTimerRef.current = null;
    stopEvidence(); // drop the in-memory buffer — nothing outlives the room
    cleanupRef.current?.();
    cleanupRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMonitoring(false);
    setVisionOn(false);
    visionOnRef.current = false;
    await flush(); // final drain
  }, [flush, stopEvidence]);

  useEffect(() => {
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, riskScore, visionOn, monitoring, start, stop };
}
