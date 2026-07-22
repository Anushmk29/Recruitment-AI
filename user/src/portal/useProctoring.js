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

// Debounce so one sustained condition (e.g. the candidate steps away) isn't logged every tick.
const DEDUPE_MS = { face_absent: 5000, multi_face: 5000, gaze_away: 7000, window_blur: 1500 };

// Calm, non-accusatory nudges — the goal is to steer back on track, not to threaten.
const WARN = {
  tab_switch: "Please stay on the interview tab.",
  window_blur: "Please keep the interview window focused.",
  fullscreen_exit: "You've left fullscreen — please return to it to continue.",
  paste: "Pasting isn't allowed — please answer in your own words.",
  face_absent: "We can't see you clearly — please stay in front of the camera.",
  multi_face: "More than one person was detected on camera.",
  gaze_away: "Please keep your attention on the screen.",
  identity_mismatch: "The camera doesn't appear to match your identity photo.",
  camera_lost: "Your camera turned off — please re-enable it to continue.",
};

export function useProctoring({ enabled = true, onWarn, referenceDescriptor } = {}) {
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

  const warnRef = useRef(onWarn);
  useEffect(() => { warnRef.current = onWarn; }, [onWarn]);
  const refDescRef = useRef(referenceDescriptor);
  useEffect(() => { refDescRef.current = referenceDescriptor; }, [referenceDescriptor]);

  // Buffer an event (server owns severity/score). Deduped per-type; optionally warns the candidate.
  const record = useCallback((type, meta, { warn = true } = {}) => {
    const now = Date.now();
    const gap = DEDUPE_MS[type];
    if (gap && now - (lastFiredRef.current[type] || 0) < gap) return;
    lastFiredRef.current[type] = now;
    queueRef.current.push(meta ? { type, meta } : { type });
    if (warn && WARN[type]) warnRef.current?.(WARN[type]);
  }, []);

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

    if (res.faceCount === 0) record("face_absent");
    else if (res.faceCount > 1) record("multi_face", { faceCount: res.faceCount });
    else if (res.gazeAway) record("gaze_away");

    // Identity match: one-shot, on the first clean single-face frame with a descriptor.
    if (!identityDoneRef.current && res.faceCount === 1 && res.descriptor && refDescRef.current) {
      const distance = faceVision.descriptorDistance(res.descriptor, refDescRef.current);
      if (distance != null) {
        identityDoneRef.current = true;
        const matched = distance < 0.6;
        if (!matched) warnRef.current?.(WARN.identity_mismatch);
        flush({ identityMatch: { matched, distance } });
      }
    }
  }, [record, flush]);

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
    const onCopy = () => record("copy", null, { warn: false });
    const onPaste = () => record("paste");
    const onContextMenu = () => record("context_menu", null, { warn: false });

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);
    cleanupRef.current = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy);
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
    } catch {
      // No camera → Tier 1 still runs; vision simply stays off.
    }

    flushTimerRef.current = setInterval(() => flush(), FLUSH_MS);
  }, [record, flush, startVision]);

  const stop = useCallback(async () => {
    if (!runningRef.current) return;
    runningRef.current = false;
    if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    if (visionTimerRef.current) clearInterval(visionTimerRef.current);
    flushTimerRef.current = null;
    visionTimerRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMonitoring(false);
    setVisionOn(false);
    visionOnRef.current = false;
    await flush(); // final drain
  }, [flush]);

  useEffect(() => {
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, riskScore, visionOn, monitoring, start, stop };
}
