import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, Circle, Camera, Mic, Maximize, Cpu, Gauge, ScanFace, Smartphone, Laptop, Volume2 } from "lucide-react";
import { PHONE_PAIRING_ENABLED } from "../lib/features.js";
import { QRCodeCanvas } from "qrcode.react";
import api from "../api/client.js";
import { getAuth, authHeader } from "../portal/portalAuth.js";
import * as faceVision from "../portal/faceVision.js";
import { measureAudioIsolation, MIC_CONSTRAINTS } from "../portal/audioIsolation.js";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import InterviewShell from "../components/portal/InterviewShell.jsx";

// Below this the live voice path is unreliable and the candidate is told so before they commit.
//
// Deliberately generous. The interview streams compressed Opus up and short MP3 clips down — it
// needs far less than this — so the floor is set where a connection stops having enough headroom
// to survive a hiccup, not where the stream stops fitting. The cost of being too strict here is
// telling someone their perfectly usable connection is a problem; the cost of having no floor at
// all was a green tick followed by a voice interview that fell apart mid-answer.
const VOICE_MIN_MBPS = 1.5;

// Phase 14.3 — which version of the clip-capture consent wording is in force.
// Bump when the wording below changes; the accepted version is stored with the
// consent record.
const EVIDENCE_CONSENT_VERSION = "2026-07-25.1";

// Hard requirements only — things the interview genuinely cannot run without.
// Screen share and fullscreen are deliberately NOT here: neither exists on
// mobile browsers, and requiring them silently hard-blocked every mobile
// candidate for capabilities the interview never actually uses.
function detectDeviceCompatibility() {
  const issues = [];
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    issues.push("Camera/microphone access is not supported in this browser");
  }
  if (typeof window.RTCPeerConnection === "undefined") {
    issues.push("Real-time video (WebRTC) is not supported in this browser");
  }
  if (typeof HTMLCanvasElement === "undefined") {
    issues.push("Canvas is not supported in this browser");
  }
  return { compatible: issues.length === 0, issues };
}

const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const FULLSCREEN_SUPPORTED = Boolean(document.documentElement.requestFullscreen);

function StatusIcon({ state }) {
  if (state === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (state === "failed") return <XCircle className="h-5 w-5 text-red-600" />;
  return <Circle className="h-5 w-5 text-slate-300" />;
}

function CheckCard({ icon: Icon, title, state, children }) {
  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon className="h-4.5 w-4.5 text-brand-600" /> {title}
        <span className="ml-auto"><StatusIcon state={state} /></span>
      </h3>
      {children}
    </Card>
  );
}

export default function PreInterviewCheck() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  const [camera, setCamera] = useState("pending");
  const [microphone, setMicrophone] = useState("pending");
  const [fullscreen, setFullscreen] = useState("pending");
  const [deviceCompat, setDeviceCompat] = useState({ status: "pending", issues: [] });
  const [speedStatus, setSpeedStatus] = useState("pending");
  const [speedMbps, setSpeedMbps] = useState(null);
  const [identityStatus, setIdentityStatus] = useState("pending");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Phase 14 — tenant integrity features + the OPTIONAL evidence-clip consent.
  // Leaving the box unchecked is a real, recorded decline — it never blocks the
  // interview; monitoring simply stays counts-only.
  const [features, setFeatures] = useState({ evidenceClips: false, secondaryCam: false });
  const [evidenceConsent, setEvidenceConsent] = useState(false);
  const [phonePair, setPhonePair] = useState(null); // { url } once a QR is minted
  // Sound check: does the output work, and does the mic hear it? Both facts come from one test
  // tone. Recommended, never required — the interview runs either way, just turn-based if the
  // interviewer would otherwise talk over itself. See portal/audioIsolation.js.
  const [sound, setSound] = useState({ status: "pending", verdict: null, ratio: null, heard: null });

  useEffect(() => {
    if (!getAuth()?.jwt) {
      navigate("/portal/dashboard", { replace: true });
      return;
    }
    const { compatible, issues } = detectDeviceCompatibility();
    setDeviceCompat({ status: compatible ? "ok" : "failed", issues });
    api
      .get("/interview-portal/me", { headers: authHeader() })
      .then((res) => setFeatures(res.data?.features || { evidenceClips: false, secondaryCam: false }))
      .catch(() => {});
  }, [navigate]);

  async function generatePhoneQr() {
    try {
      const res = await api.get("/interview-portal/phone/pair", { headers: authHeader() });
      setPhonePair({ url: res.data.url });
    } catch (err) {
      setError(err.response?.data?.error || "Could not generate the phone pairing code");
    }
  }

  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function requestCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamera("ok");
    } catch {
      setCamera("failed");
    }
  }

  // The microphone check LISTENS. It used to request the stream, confirm the browser said yes,
  // and stop the tracks immediately — so it verified PERMISSION, never AUDIO.
  //
  // That is the single most common total-failure mode in the product. A muted headset, the wrong
  // default input device, a hardware mute switch, a mic captured by another app: all of them
  // return a working MediaStream, all of them showed a green tick, and all of them produced total
  // silence at question one — by which point the candidate is inside a proctored interview they
  // cannot sit again, with no idea why nothing is happening.
  //
  // So this samples the actual level for a few seconds and requires the candidate to be heard.
  const [micLevel, setMicLevel] = useState(0); // 0-1, live, for the meter
  const [micPeak, setMicPeak] = useState(0); // loudest moment observed, decides pass/fail
  const micStopRef = useRef(null);

  // Below this the microphone is producing a flat line. Deliberately low: it has to clear the
  // noise floor of a quiet room without demanding that anyone raise their voice, because "speak
  // up to pass" is a test of confidence and not of hardware.
  const MIC_PASS_PEAK = 0.03;

  useEffect(() => () => micStopRef.current?.(), []);

  async function requestMicrophone() {
    micStopRef.current?.();
    setMicPeak(0);
    setMicLevel(0);
    setMicrophone("listening");
    let stream;
    try {
      // Same constraints the interview itself uses (echo cancellation explicitly requested, not
      // left to the browser default) so this check exercises the real pipeline.
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      setMicrophone("failed");
      return;
    }

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("no audio context");
      const ctx = new Ctx();
      // Some browsers hand back a suspended context outside a gesture; a suspended analyser reads
      // a permanent zero, which would fail every candidate on those browsers rather than the ones
      // with a broken microphone.
      if (ctx.state === "suspended") await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const frame = new Float32Array(analyser.fftSize);
      let peak = 0;

      const id = setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        const rms = Math.sqrt(sum / frame.length);
        setMicLevel(Math.min(1, rms * 12)); // scaled for the meter only, never for the verdict
        if (rms > peak) {
          peak = rms;
          setMicPeak(peak);
          if (peak >= MIC_PASS_PEAK) setMicrophone("ok");
        }
      }, 100);

      micStopRef.current = () => {
        clearInterval(id);
        micStopRef.current = null;
        try {
          if (ctx.state !== "closed") ctx.close();
        } catch { /* ignore */ }
        stream.getTracks().forEach((t) => t.stop());
        setMicLevel(0);
      };
    } catch {
      // No Web Audio here. Fall back to the old behaviour rather than blocking the interview: an
      // unmeasurable microphone is not a broken one, and refusing to let someone start because we
      // could not sample it would be a worse failure than the one this check exists to prevent.
      stream.getTracks().forEach((t) => t.stop());
      setMicrophone("ok");
    }
  }

  // Plays a short tone and listens for it. Two answers from one test: the candidate confirms their
  // output works, and we measure whether their mic hears it. The second is what decides whether the
  // interviewer may keep listening while it speaks.
  async function runSoundCheck() {
    setSound({ status: "testing", verdict: null, ratio: null, heard: null });
    const result = await measureAudioIsolation();
    setSound({ status: "confirming", verdict: result.verdict, ratio: result.ratio, heard: null });
  }

  async function requestFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreen("ok");
    } catch {
      setFullscreen("failed");
    }
  }

  async function runSpeedTest() {
    setSpeedStatus("testing");
    try {
      const start = performance.now();
      const res = await api.get("/interview-portal/speed-test-file", {
        headers: authHeader(),
        responseType: "arraybuffer",
      });
      const seconds = (performance.now() - start) / 1000;
      const mbps = (res.data.byteLength * 8) / (seconds * 1e6);
      setSpeedMbps(mbps);
      // The result used to be measured, stored, and compared to nothing — a 0.4 Mbps connection
      // passed with a green tick and then failed the voice stream mid-interview. Now it is
      // actually read: below the floor the candidate is told, up front, that typing is the
      // reliable path for them. It is a WARNING, never a block — the interview runs on any
      // connection, and refusing someone for their broadband would be a worse outcome than a
      // degraded one they were warned about.
      setSpeedStatus(mbps < VOICE_MIN_MBPS ? "slow" : "ok");
    } catch {
      setSpeedStatus("failed");
    }
  }

  function captureIdentityPhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Please enable your camera before capturing your identity photo.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      setIdentityStatus("uploading");
      try {
        const form = new FormData();
        form.append("photo", blob, "identity.jpg");
        await api.post("/interview-portal/identity-verification", form, {
          headers: { ...authHeader(), "Content-Type": "multipart/form-data" },
        });
        // Best-effort: compute a face descriptor from this same frame (entirely client-side) and
        // stash it so the interview room can match the live camera against it. Awaited (not
        // fire-and-forget) so a fast click to "Continue" can't beat it to the interview room —
        // InterviewRoom reads this key exactly once on mount, so a race here silently disables
        // identity matching for the whole session. If the vision model isn't installed, this
        // still resolves via the catch and identity match just stays unavailable — never blocks.
        try {
          await faceVision.ensureLoaded();
          // `withDescriptor` is opt-in (the interview room only pays for the recognition net on
          // identity-sample ticks) — but this call is the ONE place that must always have it: it
          // produces the reference every later match is measured against.
          const res = await faceVision.analyzeFrame(canvas, { withDescriptor: true });
          if (res?.descriptor) sessionStorage.setItem("proctorRefDescriptor", JSON.stringify(res.descriptor));
        } catch {
          // vision model unavailable/failed — identity match degrades to "unknown", never blocks.
        }
        setIdentityStatus("ok");
      } catch (err) {
        setIdentityStatus("failed");
        setError(err.response?.data?.error || "Could not upload identity photo");
      }
    }, "image/jpeg", 0.9);
  }

  // Fullscreen is recommended, never required — it doesn't exist on iOS Safari
  // and blocking on it turned away every mobile candidate.
  const allDone =
    camera === "ok" &&
    microphone === "ok" &&
    deviceCompat.status === "ok" &&
    // "slow" counts as run. The speed test informs the advice; it never decides who is allowed to
    // interview. Turning someone away for their broadband would be a worse outcome than the
    // degraded voice they have now been warned about, and typing works on any connection.
    (speedStatus === "ok" || speedStatus === "slow") &&
    identityStatus === "ok" &&
    consent;

  async function handleConfirm() {
    setSubmitting(true);
    setError("");
    try {
      const checks = await api.post(
        "/interview-portal/checks",
        {
          camera: camera === "ok",
          microphone: microphone === "ok",
          fullscreen: fullscreen === "ok",
          deviceCompatible: deviceCompat.status === "ok",
          browserInfo: navigator.userAgent,
          downloadMbps: speedMbps,
          // The loudest thing the microphone actually captured during the check. Recorded because
          // it is the evidence behind "the microphone was working when they started" — the answer
          // to a candidate who reports a silent interview, and to a recruiter looking at a session
          // with no audio in it.
          micPeak: micPeak || 0,
          // Sound check. The SERVER decides barge-in eligibility from these — skipping the check
          // leaves it "inconclusive", which fails closed to the turn-based interview.
          echoPath: sound.verdict || "inconclusive",
          echoRatio: sound.ratio ?? undefined,
          audioOutputConfirmed: sound.heard === true,
        },
        { headers: authHeader() }
      );
      await api.post(
        "/interview-portal/proctoring/consent",
        {
          given: true,
          // Phase 14.3 — the clip-capture clause is consented (or declined)
          // explicitly whenever the tenant runs evidence clips. An unchecked
          // box is a RECORDED decline, not an absence.
          ...(features.evidenceClips
            ? { evidence: { given: evidenceConsent, wordingVersion: EVIDENCE_CONSENT_VERSION } }
            : {}),
        },
        { headers: authHeader() }
      );
      // Mirror the outcome for the interview room so the rolling buffer only
      // ever starts when it's both enabled and consented.
      sessionStorage.setItem(
        "evidenceCapture",
        JSON.stringify({ enabled: features.evidenceClips, consented: evidenceConsent })
      );
      // Mirror the SERVER's barge-in decision (not our own view of it) so the interview room only
      // keeps the mic open during playback on a device where that was actually measured as safe.
      sessionStorage.setItem(
        "bargeIn",
        JSON.stringify({ eligible: checks?.data?.deviceCheck?.bargeInEligible === true })
      );
      await api.post("/interview-portal/start", {}, { headers: authHeader() });
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      navigate("/portal/interview");
    } catch (err) {
      setError(err.response?.data?.error || "Could not complete pre-interview checks");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <InterviewShell stage="setup">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pre-Interview Checks</h1>
          <p className="mt-1 text-sm text-slate-500">Complete each check below before starting your interview.</p>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

        {IS_MOBILE && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <Laptop className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              You appear to be on a phone or tablet. The interview works best on a{" "}
              <span className="font-semibold">laptop or desktop</span> — a bigger screen, steadier camera, and fewer
              interruptions. Your link keeps working, so you can switch devices and come back before it expires.
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <CheckCard icon={Camera} title="Camera" state={camera}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="mb-3 w-full max-w-xs rounded-lg bg-slate-900"
            />
            <Button variant={camera === "ok" ? "outline" : "primary"} size="sm" onClick={requestCamera} disabled={camera === "ok"}>
              {camera === "ok" ? "Camera Enabled" : "Enable Camera"}
            </Button>
          </CheckCard>

          <CheckCard icon={Mic} title="Microphone" state={microphone}>
            <Button
              variant={microphone === "ok" ? "outline" : "primary"}
              size="sm"
              onClick={requestMicrophone}
              disabled={microphone === "listening"}
            >
              {microphone === "ok" ? "Test again" : microphone === "listening" ? "Listening…" : "Enable Microphone"}
            </Button>

            {/* The meter is not decoration. Permission alone never proved a candidate could be
                heard, and a muted headset or a wrong default device passed every check and then
                produced total silence at question one. Seeing the bar move is the proof. */}
            {(microphone === "listening" || microphone === "ok") && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                  <div
                    className={`h-full rounded-full transition-[width] duration-100 ${
                      microphone === "ok" ? "bg-emerald-500" : "bg-brand-500"
                    }`}
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-600" role="status" aria-live="polite">
                  {microphone === "ok"
                    ? "We can hear you."
                    : micPeak > 0
                      ? "Say something — a little louder, or check you're not muted."
                      : "Say something so we know we can hear you."}
                </p>
              </div>
            )}

            {microphone === "failed" && (
              <p className="mt-2 text-xs text-slate-600">
                We couldn't reach your microphone. Check that no other app is using it, and that
                your browser is allowed to. You can also take this interview by typing.
              </p>
            )}
          </CheckCard>

          {/* Sound check — recommended, never required. It answers two things at once: can you
              hear the interviewer, and can your microphone hear it too. The second decides whether
              you'll be able to interrupt mid-question; if your speakers bleed into your mic, the
              interviewer would interrupt itself, so it waits its turn instead. Either way the
              interview runs. */}
          <CheckCard
            icon={Volume2}
            title="Sound (recommended)"
            state={sound.heard === true ? "ok" : sound.heard === false ? "failed" : "pending"}
          >
            {sound.status === "pending" && (
              <>
                <p className="mb-2 text-sm text-slate-500">
                  We&apos;ll play a short tone so you can check your audio. Headphones are ideal but not required.
                </p>
                <Button size="sm" onClick={runSoundCheck}>Play test tone</Button>
              </>
            )}

            {sound.status === "testing" && <p className="text-sm text-slate-500">Playing a test tone…</p>}

            {sound.status === "confirming" && sound.heard === null && (
              <>
                <p className="mb-2 text-sm text-slate-700">Did you hear the tone?</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setSound((s) => ({ ...s, heard: true }))}>Yes, I heard it</Button>
                  <Button variant="outline" size="sm" onClick={() => setSound((s) => ({ ...s, heard: false }))}>
                    No, I didn&apos;t
                  </Button>
                </div>
              </>
            )}

            {sound.heard === true && (
              <div className="space-y-1.5 text-sm">
                <p className="text-emerald-700">Audio confirmed.</p>
                {sound.verdict === "bleeding" && (
                  <p className="text-slate-500">
                    We can hear your speakers through your microphone. That&apos;s fine — the interviewer will finish each
                    question before listening. With headphones you&apos;d also be able to interrupt it mid-question.
                  </p>
                )}
                {sound.verdict === "isolated" && (
                  <p className="text-slate-500">
                    Your microphone is well isolated, so you can interrupt the interviewer mid-question if you want to.
                  </p>
                )}
                {sound.verdict === "inconclusive" && (
                  <p className="text-slate-500">
                    We couldn&apos;t measure your audio setup in this browser. The interviewer will finish each question
                    before listening.
                  </p>
                )}
              </div>
            )}

            {sound.heard === false && (
              <div className="space-y-2 text-sm">
                <p className="text-red-600">
                  Check your volume and output device, then try again. You can still take the interview by typing your
                  answers.
                </p>
                <Button variant="outline" size="sm" onClick={runSoundCheck}>Play the tone again</Button>
              </div>
            )}
          </CheckCard>

          <CheckCard icon={Maximize} title="Fullscreen (recommended)" state={fullscreen === "ok" ? "ok" : "pending"}>
            {FULLSCREEN_SUPPORTED ? (
              <>
                <p className="mb-2 text-sm text-slate-500">
                  Recommended so notifications and other windows don't distract you. Optional — you can start without it.
                </p>
                <Button variant={fullscreen === "ok" ? "outline" : "primary"} size="sm" onClick={requestFullscreen} disabled={fullscreen === "ok"}>
                  {fullscreen === "ok" ? "Fullscreen Enabled" : "Enter Fullscreen"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-slate-500">Fullscreen isn't available in this browser — you can start without it.</p>
            )}
          </CheckCard>

          <CheckCard icon={Cpu} title="Device Compatibility" state={deviceCompat.status}>
            {deviceCompat.status === "ok" && <p className="text-sm text-emerald-700">Your device and browser are compatible.</p>}
            {deviceCompat.status === "failed" && (
              <ul className="space-y-1 text-sm text-red-600">
                {deviceCompat.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </CheckCard>

          <CheckCard
            icon={Gauge}
            title="Internet Speed Check"
            state={speedStatus === "testing" ? "pending" : speedStatus === "slow" ? "ok" : speedStatus}
          >
            {speedMbps !== null && <p className="mb-2 text-sm text-slate-600">Estimated download speed: {speedMbps.toFixed(1)} Mbps</p>}
            {/* A slow connection does not block the interview — it changes the advice. The old
                behaviour measured this and compared it to nothing, so a 0.4 Mbps line passed with
                a green tick and then dropped the voice stream mid-answer, which the candidate
                experienced as the interview breaking rather than as something they could have
                planned around. */}
            {speedStatus === "slow" && (
              <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                That's on the slow side for live voice. You can still speak your answers, but if the
                audio struggles, switching to typing at any point is completely fine — typed answers
                are assessed the same way.
              </p>
            )}
            <Button
              variant={speedStatus === "ok" || speedStatus === "slow" ? "outline" : "primary"}
              size="sm"
              onClick={runSpeedTest}
              disabled={speedStatus === "testing"}
            >
              {speedStatus === "testing" ? "Testing…" : speedMbps !== null ? "Run Again" : "Run Speed Test"}
            </Button>
          </CheckCard>

          <CheckCard icon={ScanFace} title="Identity Verification" state={identityStatus === "uploading" ? "pending" : identityStatus} >
            <p className="mb-2 text-sm text-slate-500">Enable your camera above, then capture a photo for identity verification.</p>
            <Button
              variant={identityStatus === "ok" ? "outline" : "primary"}
              size="sm"
              onClick={captureIdentityPhoto}
              disabled={camera !== "ok" || identityStatus === "uploading"}
            >
              {identityStatus === "uploading" ? "Uploading…" : identityStatus === "ok" ? "Photo Captured" : "Capture Photo"}
            </Button>
          </CheckCard>
        </div>

        {/* Two gates, deliberately. `PHONE_PAIRING_ENABLED` is ours and is off:
            the pairing flow is shelved, not removed. `features.secondaryCam` is
            the tenant's own server-side setting and stays in the condition so
            turning the frontend switch back on does not silently override a
            company that has the feature disabled. */}
        {PHONE_PAIRING_ENABLED && features.secondaryCam && (
          <CheckCard icon={Smartphone} title="Phone as Second Camera (optional)" state={phonePair ? "ok" : "pending"}>
            <p className="mb-3 text-sm text-slate-500">
              Optionally add your phone as a second camera angle. Scan the QR with your phone — it only sends a
              presence signal and integrity events; <span className="font-medium text-slate-700">it never streams video</span>.
            </p>
            {phonePair ? (
              <div className="flex flex-col items-start gap-2">
                <div className="rounded-lg bg-white p-2 shadow-sm">
                  <QRCodeCanvas value={phonePair.url} size={148} />
                </div>
                <p className="text-xs text-slate-400">Scan with your phone camera. The code expires in 10 minutes.</p>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={generatePhoneQr}>
                Show Pairing QR
              </Button>
            )}
          </CheckCard>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              This is a <span className="font-medium text-slate-800">monitored interview</span>. I consent to my camera and
              on-screen activity being monitored for integrity during the session (tab-switching, leaving fullscreen, and
              camera checks such as face presence and identity matching). Camera analysis runs in my browser — raw video is
              not uploaded; only integrity signals are recorded for the hiring team's review.
            </span>
          </label>
        </div>

        {features.evidenceClips && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="flex items-start gap-3 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={evidenceConsent}
                onChange={(e) => setEvidenceConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="font-medium text-slate-800">Optional — short evidence clips.</span> I consent to a short
                video clip (up to ~15 seconds, at most 6 per session) being saved for the hiring team's review{" "}
                <span className="font-medium text-slate-700">only if</span> a serious integrity flag is raised (for
                example, a second person on camera). I am <span className="font-medium text-slate-700">never recorded
                continuously</span> — video stays in my browser's memory and is discarded unless such a flag occurs.
                Declining does not affect my interview.
              </span>
            </label>
          </div>
        )}

        <Button size="lg" onClick={handleConfirm} loading={submitting} disabled={!allDone}>
          Confirm &amp; Start Interview
        </Button>
      </div>
    </InterviewShell>
  );
}
