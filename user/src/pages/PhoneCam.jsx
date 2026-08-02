// Phone companion camera (BUILD-PLAN Phase 14.6). Opened by scanning the QR on
// the pre-check screen. The phone NEVER streams video: it exchanges the scanned
// single-purpose pairing token for a phone-session token (sessionStorage only),
// runs the same in-browser face model as the laptop, sends a presence heartbeat
// every ~10s, posts integrity events, and — only with evidence consent given on
// the laptop AND a qualifying event — uploads a short clip through the same
// server-capped endpoint. Closing this page stops the heartbeat, which raises
// phone_cam_lost in the risk model on the laptop's next flush.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Smartphone, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import * as faceVision from "../portal/faceVision.js";

const HEARTBEAT_MS = 10000;
const VISION_MS = 1000;
// Same confirmation discipline as the laptop monitor (portal/useProctoring.js): a second face must
// hold for 2 continuous seconds before it is reported. On a propped-up phone a reflection, a poster,
// or someone crossing the room behind the candidate would otherwise raise a high-severity flag off
// a single frame — and the phone's wide, low, moving viewpoint sees far more of those than a laptop
// webcam does.
const MULTI_FACE_CONFIRM_TICKS = 2;
const SEGMENT_MS = 15000;
const MAX_UPLOADS = 3; // advisory phone-side share of the server's per-session cap
const COOLDOWN_MS = 45000;

const STORAGE_KEY = "phoneCamAuth";

export default function PhoneCam() {
  const { token } = useParams();
  const [state, setState] = useState("connecting"); // connecting | live | error | ended
  const [error, setError] = useState("");
  // What this phone is actually doing, so the screen can say so. `camera` false
  // means getUserMedia was refused or unavailable; `vision` false means the face
  // model would not load. Either one degrades the companion to presence-only,
  // and a degraded companion must never render as a working one.
  const [capability, setCapability] = useState({ camera: false, vision: false });
  const videoRef = useRef(null);
  const jwtRef = useRef(null);
  const timersRef = useRef([]);
  const streamRef = useRef(null);
  const visionOnRef = useRef(false);
  const evRef = useRef({ recorder: null, chunks: [], startedAt: 0, pending: null, uploads: 0, lastAt: {} });

  const phoneHeader = useCallback(() => ({ Authorization: `Bearer ${jwtRef.current}` }), []);

  const uploadClip = useCallback(
    async (blob, eventType, durationMs) => {
      try {
        const form = new FormData();
        form.append("clip", blob, "clip.webm");
        form.append("eventType", eventType);
        form.append("durationMs", String(Math.round(durationMs)));
        await api.post("/interview-portal/phone/evidence", form, { headers: phoneHeader() });
        evRef.current.uploads += 1;
      } catch {
        // Silent degrade — evidence is best-effort everywhere.
      }
    },
    [phoneHeader]
  );

  const startSegment = useCallback(() => {
    const ev = evRef.current;
    const stream = streamRef.current;
    if (!stream || !window.MediaRecorder) return;
    let recorder;
    try {
      const mime = MediaRecorder.isTypeSupported?.("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 400000 });
    } catch {
      return;
    }
    ev.chunks = [];
    ev.startedAt = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) ev.chunks.push(e.data);
    };
    recorder.onstop = () => {
      const pending = ev.pending;
      ev.pending = null;
      if (pending && ev.chunks.length) {
        const blob = new Blob(ev.chunks, { type: "video/webm" });
        if (blob.size > 1000 && blob.size <= 6 * 1024 * 1024) uploadClip(blob, pending, Date.now() - ev.startedAt);
      }
      ev.chunks = [];
      if (streamRef.current) startSegment();
    };
    recorder.start(1000);
    ev.recorder = recorder;
  }, [uploadClip]);

  const captureEvidence = useCallback((eventType) => {
    const ev = evRef.current;
    if (!ev.recorder || ev.recorder.state !== "recording" || ev.pending) return;
    if (ev.uploads >= MAX_UPLOADS) return;
    const now = Date.now();
    if (now - (ev.lastAt[eventType] || 0) < COOLDOWN_MS) return;
    ev.lastAt[eventType] = now;
    ev.pending = eventType;
    try {
      ev.recorder.stop();
    } catch {
      ev.pending = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        // Exchange the scanned pairing token for the phone-session token. Kept in
        // sessionStorage ONLY (guardrail): closing the tab forgets it.
        const res = await api.post("/interview-portal/phone/login", { token });
        if (cancelled) return;
        jwtRef.current = res.data.token;
        sessionStorage.setItem(STORAGE_KEY, res.data.token);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || "Pairing failed — generate a fresh QR on the laptop.");
          setState("error");
        }
        return;
      }

      // Camera preview + vision. Rear camera preferred for a second angle.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: 320, height: 240 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        // Attaching here is NOT enough: see the attach effect below. connect()
        // resolves while state is still "connecting", so on first pair-up the
        // <video> is not in the DOM yet and this assignment lands on nothing.
        if (videoRef.current) videoRef.current.srcObject = stream;
        if (!cancelled) setCapability((c) => ({ ...c, camera: true }));
      } catch {
        // No camera → the phone still heartbeats (presence-only mode).
      }

      setState("live");

      // Presence heartbeat — the whole point of the companion.
      const beat = async () => {
        try {
          await api.post("/interview-portal/phone/heartbeat", {}, { headers: phoneHeader() });
        } catch (err) {
          if (err.response?.status === 410 && !cancelled) {
            setState("ended");
            cleanup();
          }
        }
      };
      beat();
      timersRef.current.push(setInterval(beat, HEARTBEAT_MS));

      // Same in-browser vision as the laptop; events land in the same risk model.
      try {
        await faceVision.ensureLoaded();
        visionOnRef.current = true;
      } catch {
        visionOnRef.current = false;
      }
      if (!cancelled) setCapability((c) => ({ ...c, vision: visionOnRef.current && Boolean(streamRef.current) }));
      if (visionOnRef.current && streamRef.current) {
        startSegment();
        const queue = [];
        // Consecutive-tick confirmation. `streak` counts uninterrupted seconds; `fired` makes one
        // confirmed episode emit one event instead of one per tick. Any unreadable tick resets
        // both — losing sight of the frame is not evidence, so the clock restarts.
        const multi = { streak: 0, fired: false };
        timersRef.current.push(
          setInterval(async () => {
            const video = videoRef.current;
            if (!video || video.readyState < 2 || video.videoWidth === 0) {
              multi.streak = 0;
              multi.fired = false;
              return;
            }
            let res;
            try {
              res = await faceVision.analyzeFrame(video);
            } catch {
              multi.streak = 0;
              multi.fired = false;
              return;
            }
            if (!res) {
              multi.streak = 0;
              multi.fired = false;
              return;
            }
            if (res.faceCount > 1) {
              multi.streak += 1;
              if (!multi.fired && multi.streak >= MULTI_FACE_CONFIRM_TICKS) {
                multi.fired = true;
                queue.push({ type: "multi_face", meta: { faceCount: res.faceCount } });
                captureEvidence("multi_face");
              }
            } else {
              multi.streak = 0;
              multi.fired = false;
            }
            if (queue.length) {
              const events = queue.splice(0, queue.length);
              api.post("/interview-portal/phone/events", { events }, { headers: phoneHeader() }).catch(() => {});
            }
          }, VISION_MS)
        );
        timersRef.current.push(
          setInterval(() => {
            const ev = evRef.current;
            if (ev.recorder && ev.recorder.state === "recording" && !ev.pending) {
              try {
                ev.recorder.stop();
              } catch {
                // ignore
              }
            }
          }, SEGMENT_MS)
        );
      }
    }

    function cleanup() {
      timersRef.current.forEach(clearInterval);
      timersRef.current = [];
      const ev = evRef.current;
      try {
        if (ev.recorder && ev.recorder.state !== "inactive") ev.recorder.stop();
      } catch {
        // ignore
      }
      ev.recorder = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    connect();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Attach the stream to the preview AFTER render, every render, until it takes.
  // getUserMedia resolves inside connect() while state is still "connecting", so
  // the inline assignment there runs against a ref React has not populated yet.
  // Nothing re-attached it, which left the element with no source: a black box
  // under a heading that said the camera was active — and, worse, silently dead
  // vision, because the analyse loop reads videoWidth off this same element and
  // bails on every tick while it is 0.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 py-10 text-center text-white">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
        <Smartphone className="h-7 w-7 text-brand-300" />
      </div>

      {state === "connecting" && <p className="text-sm text-slate-300">Connecting your phone as a second camera…</p>}

      {/* The heading states what this phone is actually doing. It used to read
          "Second camera active" even when getUserMedia had been refused outright,
          which is a placeholder dressed as a measurement — the one thing this
          product is not allowed to ship. */}
      {state === "live" &&
        (capability.camera && capability.vision ? (
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" /> Second camera active
          </h1>
        ) : (
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden="true" /> Presence only — camera not watching
          </h1>
        ))}

      {/* ALWAYS mounted. Rendering this element conditionally is what broke the
          preview: the ref is null while the stream is being attached, and a
          later mount produces a fresh element nobody re-attaches. Hiding it is
          safe; unmounting it is not. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={
          state === "live" && capability.camera ? "mt-5 w-full max-w-xs rounded-xl bg-black" : "hidden"
        }
      />

      {state === "live" && (
        <p className="mt-5 max-w-sm text-sm text-slate-400">
          {capability.camera && capability.vision ? (
            <>
              Keep this page open and the phone propped up with you in view. Nothing is streamed — this page only sends
              a presence signal and integrity events. Closing it will flag the camera as disconnected.
            </>
          ) : (
            <>
              This phone is confirming you are present, but it is not watching the room —{" "}
              {capability.camera ? "the on-device face model could not load" : "camera access was not granted"}. Keep
              the page open; closing it will flag the camera as disconnected. Your laptop camera is unaffected.
            </>
          )}
        </p>
      )}

      {state === "error" && (
        <>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <XCircle className="h-5 w-5 text-red-400" /> Pairing failed
          </h1>
          <p className="mt-3 max-w-sm text-sm text-slate-400">{error}</p>
        </>
      )}

      {state === "ended" && <p className="text-sm text-slate-300">The interview has ended — you can close this page.</p>}
    </div>
  );
}
