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
// 1000ms, down from 2500ms. The confirmation windows below are expressed in ticks, and a 2.5s
// sampler simply cannot express "gone for 3 seconds" — it can only say 2.5s or 5s. At 1s a tick
// count IS a number of seconds, so every threshold in this file means exactly what it says.
const VISION_MS = 1000;

// --- Confirmation windows (consecutive ticks == seconds) ---
//
// Nothing below is reported on a single frame. Every condition must hold for its full window with
// no interruption and no unreadable tick in between. The previous code logged `face_absent` on the
// FIRST zero-face frame, which meant one dropped detection became a permanent, weighted flag on a
// candidate's report — and a "sustained" clip could be assembled from three non-consecutive misses
// minutes apart, producing footage that visibly contradicted its own label.
const CONFIRM_TICKS = {
  multi_face: 2, // 2s — a reflection, a poster, or someone walking past no longer trips it
  face_absent: 4, // 4s of continuous no-face
  gaze_away: 7, // 7s of continuously looking away
};

// A "marginal" last-good read means the detector was already struggling when it lost the face:
// barely over threshold, tiny in frame, or cropped by an edge. An absence that begins from a
// marginal read is far more likely to be the detector giving up than the candidate leaving, so it
// is reported as `detector_uncertain` — a fact about the CAMERA, carrying zero risk weight — rather
// than as the candidate's absence. Two different propositions; the server scores only one of them.
const MARGINAL_SCORE = 0.62;
const MARGINAL_BOX_RATIO = 0.015; // face smaller than ~1.5% of frame area

// --- Identity re-verification ---
// Identity used to be checked exactly ONCE, on the first clean frame, and then latched forever —
// so a person swapping in at minute 10 was invisible to the entire system. It is now re-sampled
// for the whole session. A mismatch must repeat on consecutive samples before it is reported:
// one bad sample is lighting, two in a row is a different face.
const IDENTITY_SAMPLE_TICKS = 15; // re-sample every ~15s
const IDENTITY_CONFIRM_SAMPLES = 2;
const IDENTITY_MATCH_DISTANCE = 0.6; // face-api's conventional 128-d "same face" bound

// --- Evidence clips (Phase 14.2) ---
// Two MediaRecorders run on the same stream, started half a segment apart, so there is always a
// valid self-contained WebM covering the recent past (a chunk ring can't be replayed without its
// header chunk). When a qualifying event fires, the OLDER lane is finalised and uploaded.
//
// The stagger is the point: a single rotating recorder yields a clip of uniformly random length
// between 0 and the segment length — about a third of them under 5s, and some effectively empty.
// A 0.8-second clip cannot substantiate or refute anything. With two lanes the older one is always
// at least half a segment old, so every clip carries 7.5-15s of context ending at the event.
//
// Everything here is advisory client-side — the server re-enforces consent, type, size, magic
// bytes, and the per-session cap.
const EVIDENCE_SEGMENT_MS = 15000;
const EVIDENCE_COOLDOWN_MS = 45000; // per event type

// Per-session clip budget, allocated by severity instead of first-come-first-served. With three
// live triggers a flat cap meant a candidate who glanced at their notes early burned the whole
// budget before a genuine multi-face event at minute 20 could ever be captured. `RESERVED_FOR_HIGH`
// slots are unreachable by low-severity types no matter how much noise came first.
const EVIDENCE_MAX_UPLOADS = 6; // advisory mirror of the server cap
const RESERVED_FOR_HIGH = 3;
const HIGH_SEVERITY_CLIPS = new Set(["multi_face", "identity_mismatch"]);
const CLIP_PER_TYPE_CAP = {
  multi_face: 3,
  identity_mismatch: 2,
  face_absent: 2,
  gaze_away: 2,
  attention_pattern: 1,
  detector_uncertain: 1,
};

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
//
// `gaze_away` is deliberately NOT in here any more: it now fires only after 7 continuous seconds
// and captures its own clip, so counting it as ambient noise as well would double-spend the budget
// on one episode.
const AMBIENT_NOISE_TYPES = new Set(["tab_switch", "window_blur", "context_menu"]);
const AMBIENT_NOISE_THRESHOLD = 5;

// Debounce so one sustained condition (e.g. the candidate steps away) isn't logged every tick.
// The vision types are absent from this map on purpose — their repetition is now governed by the
// confirmation state machine (one event per confirmed episode), which is a stronger guarantee than
// a time-based debounce could give.
const DEDUPE_MS = { window_blur: 1500 };

// Calm, non-accusatory nudges — the goal is to steer back on track, not to threaten.
const WARN = {
  tab_switch: "Please stay on the interview tab.",
  window_blur: "Please keep the interview window focused.",
  fullscreen_exit: "You've left fullscreen — please return to it to continue.",
  copy: "Copying is disabled during this interview.",
  paste: "Pasting is disabled during this interview — please answer in your own words.",
  face_absent: "We can't see you on camera — please come back into frame.",
  // Addressed to the SETUP, not the candidate's conduct: this fires when our own detector is
  // struggling, and the honest, useful thing to say is how to help it rather than to imply they
  // did something. It carries no risk weight server-side.
  detector_uncertain: "We're having trouble seeing you clearly — more light, or moving a little closer, will help.",
  multi_face: "More than one person was detected on camera.",
  gaze_away: "Please keep your attention on the screen.",
  identity_mismatch: "The camera doesn't appear to match your identity photo.",
  camera_lost: "Your camera turned off — please re-enable it to continue.",
};

// Is there budget left for one more clip of this type? Reserved slots keep high-severity evidence
// capturable no matter how much low-severity noise arrived first. `shared.reserved` counts captures
// already in flight — the check has to be pessimistic because uploads resolve asynchronously and
// several triggers can fire between a capture and its upload completing.
function hasClipBudget(shared, eventType) {
  const spent = shared.uploads + shared.reserved;
  if (spent >= EVIDENCE_MAX_UPLOADS) return false;
  const perType = CLIP_PER_TYPE_CAP[eventType] ?? 1;
  if ((shared.byType[eventType] || 0) >= perType) return false;
  if (!HIGH_SEVERITY_CLIPS.has(eventType) && spent >= EVIDENCE_MAX_UPLOADS - RESERVED_FOR_HIGH) return false;
  return true;
}

// Generic staggered-segment upload state machine, instantiated once per stream source (raw camera /
// blurred canvas). `shared` is the SAME object across both instances so the per-session budget is
// enforced across both pipelines combined, matching the server's per-session (not per-source) cap.
//
// Two lanes run concurrently on one stream, offset by half a segment. `capture()` finalises the
// OLDER lane, which is therefore always at least segmentMs/2 old — that is what guarantees a clip
// long enough to actually show a reviewer what happened.
function createClipPipeline({ getStream, uploadClip, shared, cooldownMs, segmentMs }) {
  const lanes = [
    { recorder: null, chunks: [], startedAt: 0, pending: null, rotateTimer: null, startTimer: null },
    { recorder: null, chunks: [], startedAt: 0, pending: null, rotateTimer: null, startTimer: null },
  ];
  const st = { active: false, lastCaptureAt: {} };

  function startSegment(lane) {
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
    lane.chunks = [];
    lane.startedAt = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) lane.chunks.push(e.data);
    };
    recorder.onstop = () => {
      const pending = lane.pending;
      lane.pending = null;
      if (pending && lane.chunks.length) {
        const blob = new Blob(lane.chunks, { type: "video/webm" });
        // ~6MB server cap; skip rather than fail loudly if a segment overshoots.
        if (blob.size > 1000 && blob.size <= 6 * 1024 * 1024) {
          uploadClip(blob, pending.eventType, Date.now() - lane.startedAt, pending.context);
        } else {
          shared.reserved = Math.max(0, shared.reserved - 1); // nothing shipped — release the slot
        }
      } else if (pending) {
        shared.reserved = Math.max(0, shared.reserved - 1);
      }
      lane.chunks = [];
      if (st.active) startSegment(lane); // rotate into a fresh segment
    };
    recorder.start(1000);
    lane.recorder = recorder;
  }

  function rotate(lane) {
    if (st.active && lane.recorder && lane.recorder.state === "recording" && !lane.pending) {
      try {
        lane.recorder.stop(); // onstop discards + restarts → fresh segment
      } catch {
        // ignore
      }
    }
  }

  function stopLane(lane) {
    if (lane.startTimer) clearTimeout(lane.startTimer);
    if (lane.rotateTimer) clearInterval(lane.rotateTimer);
    lane.startTimer = null;
    lane.rotateTimer = null;
    lane.pending = null;
    try {
      if (lane.recorder && lane.recorder.state !== "inactive") lane.recorder.stop();
    } catch {
      // already stopped
    }
    lane.recorder = null;
    lane.chunks = [];
  }

  return {
    start() {
      if (st.active || !window.MediaRecorder || !getStream()) return;
      st.active = true;
      lanes.forEach((lane, i) => {
        const offset = i * (segmentMs / 2);
        const begin = () => {
          startSegment(lane);
          lane.rotateTimer = setInterval(() => rotate(lane), segmentMs);
        };
        if (offset === 0) begin();
        else lane.startTimer = setTimeout(begin, offset);
      });
    },
    stop() {
      st.active = false;
      lanes.forEach(stopLane);
    },
    // Finalise the oldest ready lane and ship it as evidence for `eventType`.
    capture(eventType, context) {
      if (!st.active) return;
      const now = Date.now();
      if (now - (st.lastCaptureAt[eventType] || 0) < cooldownMs) return;
      if (!hasClipBudget(shared, eventType)) return;
      const ready = lanes
        .filter((l) => l.recorder && l.recorder.state === "recording" && !l.pending)
        .sort((a, b) => a.startedAt - b.startedAt);
      const lane = ready[0];
      if (!lane) return;
      st.lastCaptureAt[eventType] = now;
      shared.reserved += 1; // held until the upload resolves either way
      lane.pending = { eventType, at: now, context };
      try {
        lane.recorder.stop(); // onstop uploads this segment, then rotates
      } catch {
        lane.pending = null;
        shared.reserved = Math.max(0, shared.reserved - 1);
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
  const visionOnRef = useRef(false);
  const runningRef = useRef(false);
  const cleanupRef = useRef(null); // removes the Tier-1 DOM listeners
  const ambientCountRef = useRef(0);
  const visionBusyRef = useRef(false); // a tick may outlive its interval — never overlap analyses

  // Confirmation state machine. `streak` counts CONSECUTIVE ticks a condition has held; `fired`
  // makes each confirmed episode emit exactly one event rather than one per tick thereafter.
  const conditionRef = useRef({
    streak: { multi_face: 0, face_absent: 0, gaze_away: 0 },
    fired: { multi_face: false, face_absent: false, gaze_away: false },
    lastGoodRead: null, // { score, boxRatio, atEdge, at } — quality context for the last real detection
    gazeDirection: null, // "down" | "side" for the in-progress gaze episode
    ticks: 0,
  });

  // Rolling identity verification (replaces the old one-shot latch).
  const identityRef = useRef({ mismatchStreak: 0, matchStreak: 0, reported: null, lastDistance: null });

  const warnRef = useRef(onWarn);
  useEffect(() => { warnRef.current = onWarn; }, [onWarn]);
  const refDescRef = useRef(referenceDescriptor);
  useEffect(() => { refDescRef.current = referenceDescriptor; }, [referenceDescriptor]);

  // Evidence buffer state (Phase 14.2/14.7). No consent → the buffers NEVER start; there is nothing
  // to "not upload" because nothing is ever held. This object is shared across BOTH pipelines below
  // so the budget is enforced across their combined total, matching the server's per-session cap.
  const evidenceRef = useRef({ uploads: 0, reserved: 0, byType: {}, failures: 0 });
  const evidenceOptRef = useRef(evidence);
  useEffect(() => { evidenceOptRef.current = evidence; }, [evidence]);

  const rawPipelineRef = useRef(null); // identity-critical events — unblurred raw camera stream
  const blurPipelineRef = useRef(null); // attention_pattern only — blurred canvas stream
  const blurCanvasRef = useRef(null);
  const blurCtxRef = useRef(null);
  const blurStreamRef = useRef(null);
  const blurDrawTimerRef = useRef(null);
  const lastFaceBoxRef = useRef({ box: null, at: 0 });

  const uploadClip = useCallback(async (blob, eventType, durationMs, context) => {
    const ev = evidenceRef.current;
    try {
      const form = new FormData();
      form.append("clip", blob, "clip.webm");
      form.append("eventType", eventType);
      form.append("durationMs", String(Math.round(durationMs)));
      // The measurement that triggered this clip, travelling WITH it. This is the whole posture:
      // a reviewer sees the claim and the evidence side by side, so a clip that contradicts its own
      // label is obvious at a glance instead of quietly damning someone. The server allow-lists and
      // clamps these fields — nothing free-form from the browser reaches the report.
      if (context) form.append("trigger", JSON.stringify(context));
      await api.post("/interview-portal/proctoring/evidence", form, { headers: authHeader() });
      ev.uploads += 1;
      ev.byType[eventType] = (ev.byType[eventType] || 0) + 1;
    } catch (err) {
      // A failed upload degrades silently to counts-only behaviour — clip capture must never block
      // or disturb the interview. It is still counted and logged: a 400 here means the client is
      // triggering a type the server does not allow-list, which is a bug, not a candidate signal.
      ev.failures += 1;
      if (import.meta.env?.DEV) {
        console.warn(`[proctoring] evidence upload failed for "${eventType}":`, err?.response?.status || err?.message);
      }
    } finally {
      ev.reserved = Math.max(0, ev.reserved - 1);
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
        cooldownMs: EVIDENCE_COOLDOWN_MS,
        segmentMs: EVIDENCE_SEGMENT_MS,
      });
    }
    if (!blurPipelineRef.current) {
      blurPipelineRef.current = createClipPipeline({
        getStream: () => blurStreamRef.current,
        uploadClip,
        shared: evidenceRef.current,
        cooldownMs: EVIDENCE_COOLDOWN_MS,
        segmentMs: EVIDENCE_SEGMENT_MS,
      });
    }
    startBlurCanvas();
    rawPipelineRef.current.start();
    blurPipelineRef.current.start();
  }, [uploadClip, startBlurCanvas]);

  // Finalise the current segment on the appropriate pipeline (raw for identity-critical events,
  // blurred for attention_pattern) and ship it as evidence for `eventType`. `context` is the
  // measurement that justified the capture and is stored alongside the clip.
  const captureEvidence = useCallback((eventType, context) => {
    const pipeline = BLUR_EVENT_TYPES.has(eventType) ? blurPipelineRef.current : rawPipelineRef.current;
    pipeline?.capture(eventType, context);
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

  // Advance one condition's confirmation state. Returns true EXACTLY ONCE per episode: on the tick
  // the condition completes its full uninterrupted window.
  const observe = useCallback((type, active) => {
    const c = conditionRef.current;
    if (!active) {
      c.streak[type] = 0;
      c.fired[type] = false;
      return false;
    }
    c.streak[type] += 1;
    if (c.fired[type] || c.streak[type] < CONFIRM_TICKS[type]) return false;
    c.fired[type] = true;
    return true;
  }, []);

  // An unreadable tick breaks every in-progress episode. This is the fix for the defect that made
  // "sustained" a lie: the old loop returned early on a hidden/stalled video or a thrown analysis
  // WITHOUT touching the streak counter, so three misses spread minutes apart could assemble a clip
  // labelled as continuous absence. Losing observability is not evidence of anything, so the clock
  // restarts rather than quietly carrying on.
  const breakEpisodes = useCallback(() => {
    const c = conditionRef.current;
    for (const k of Object.keys(c.streak)) {
      c.streak[k] = 0;
      c.fired[k] = false;
    }
    c.gazeDirection = null;
  }, []);

  // --- Tier 2 vision loop ---
  const runVisionTick = useCallback(async () => {
    if (visionBusyRef.current) return; // analysis is slower than the 1s tick on modest hardware
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      breakEpisodes();
      return;
    }
    const c = conditionRef.current;
    c.ticks += 1;
    // The recognition net is the expensive part of the pipeline (~6MB model). At a 1s tick it only
    // runs on identity-sample ticks, not every frame — presence, multi-face and gaze need only the
    // detector and the landmarks.
    const wantDescriptor = Boolean(refDescRef.current) && c.ticks % IDENTITY_SAMPLE_TICKS === 0;

    let res;
    visionBusyRef.current = true;
    try {
      res = await faceVision.analyzeFrame(video, { withDescriptor: wantDescriptor });
    } catch {
      breakEpisodes();
      return;
    } finally {
      visionBusyRef.current = false;
    }
    if (!res) {
      breakEpisodes();
      return;
    }
    if (res.faceBox) lastFaceBoxRef.current = { box: res.faceBox, at: Date.now() };

    // --- Multiple people in frame (2s confirmation) ---
    if (observe("multi_face", res.faceCount > 1)) {
      record("multi_face", { faceCount: res.faceCount });
      captureEvidence("multi_face", {
        rule: `${CONFIRM_TICKS.multi_face} consecutive seconds with more than one face`,
        faceCount: res.faceCount,
        detectorScore: res.score,
      });
    }

    // --- Candidate absent (4s confirmation), split from detector failure ---
    const absent = res.faceCount === 0;
    if (observe("face_absent", absent)) {
      // Was the detector already struggling when it lost the face? If the last real read was
      // marginal — barely over threshold, tiny in frame, or edge-cropped — this is far more likely
      // to be the camera than the candidate, and it must not be scored as absence.
      const last = c.lastGoodRead;
      const marginal =
        !last || last.score < MARGINAL_SCORE || last.boxRatio < MARGINAL_BOX_RATIO || last.atEdge;
      const context = {
        rule: `${CONFIRM_TICKS.face_absent} consecutive seconds with no face detected`,
        lastDetectorScore: last?.score ?? null,
        lastFaceFrameRatio: last?.boxRatio ?? null,
        lastFaceAtEdge: last?.atEdge ?? null,
      };
      if (marginal) {
        // Zero risk weight server-side. It is a statement about our camera, not about the person.
        record("detector_uncertain");
        captureEvidence("detector_uncertain", { ...context, classified: "detector_uncertain" });
      } else {
        record("face_absent");
        captureEvidence("face_absent", { ...context, classified: "face_absent" });
      }
    }

    // --- Looking away (7s confirmation) ---
    // Direction is carried through the episode because "down" (notes, a phone, a keyboard) and
    // "side" (a second monitor, another person) are different findings for a reviewer.
    const gazing = res.faceCount === 1 && res.gazeAway;
    if (gazing && !c.gazeDirection) c.gazeDirection = res.gazeDirection;
    if (observe("gaze_away", gazing)) {
      const direction = c.gazeDirection || res.gazeDirection || null;
      record("gaze_away", { direction });
      captureEvidence("gaze_away", {
        rule: `${CONFIRM_TICKS.gaze_away} consecutive seconds looking away from the screen`,
        direction,
        detectorScore: res.score,
      });
    }
    if (!gazing) c.gazeDirection = null;

    // Remember the quality of this read so the NEXT absence can be classified honestly.
    if (res.faceCount >= 1) {
      c.lastGoodRead = { score: res.score, boxRatio: res.boxRatio, atEdge: res.atEdge, at: Date.now() };
    }

    // --- Rolling identity verification ---
    // Sampled for the whole session rather than latched on the first frame, and a mismatch has to
    // repeat on consecutive samples before it counts: one bad sample is lighting, two is a face.
    if (wantDescriptor && res.faceCount === 1 && res.descriptor && refDescRef.current) {
      const distance = faceVision.descriptorDistance(res.descriptor, refDescRef.current);
      if (distance != null) {
        const id = identityRef.current;
        const matched = distance < IDENTITY_MATCH_DISTANCE;
        id.lastDistance = distance;
        id.mismatchStreak = matched ? 0 : id.mismatchStreak + 1;
        id.matchStreak = matched ? id.matchStreak + 1 : 0;

        const confirmedMismatch = id.mismatchStreak >= IDENTITY_CONFIRM_SAMPLES;
        const confirmedMatch = id.matchStreak >= 1;
        const status = confirmedMismatch ? "mismatch" : confirmedMatch ? "match" : null;
        // Report only on a CHANGE of confirmed status — the server counts a mismatch transition as
        // a risk event, so re-sending the same verdict every 15s would inflate it by repetition.
        if (status && status !== id.reported) {
          id.reported = status;
          if (status === "mismatch") {
            warnRef.current?.(WARN.identity_mismatch);
            captureEvidence("identity_mismatch", {
              rule: `${IDENTITY_CONFIRM_SAMPLES} consecutive identity samples beyond the match threshold`,
              distance,
              threshold: IDENTITY_MATCH_DISTANCE,
            });
          }
          flush({ identityMatch: { matched: status === "match", distance } });
        }
      }
    }
  }, [record, flush, captureEvidence, observe, breakEpisodes]);

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
    //
    // 640x480, up from 320x240. face-api pads the frame to a square before resizing to the
    // detector's input size, so the old capture left roughly a 60px face to judge — thin enough
    // that ordinary backlight or a downward glance read as ABSENT. `ideal` (not `exact`) so a
    // webcam that cannot do 640x480 still yields a stream rather than throwing and dropping the
    // candidate to Tier-1-only monitoring.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
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
