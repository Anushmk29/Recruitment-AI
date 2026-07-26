import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, Circle, Camera, Mic, ScreenShare, Maximize, Cpu, Gauge, ScanFace, Smartphone } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import api from "../api/client.js";
import { getAuth, authHeader } from "../portal/portalAuth.js";
import * as faceVision from "../portal/faceVision.js";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import InterviewShell from "../components/portal/InterviewShell.jsx";

// Phase 14.3 — which version of the clip-capture consent wording is in force.
// Bump when the wording below changes; the accepted version is stored with the
// consent record.
const EVIDENCE_CONSENT_VERSION = "2026-07-25.1";

function detectDeviceCompatibility() {
  const issues = [];
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    issues.push("Camera/microphone access is not supported in this browser");
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    issues.push("Screen sharing is not supported in this browser");
  }
  if (!document.documentElement.requestFullscreen) {
    issues.push("Fullscreen mode is not supported in this browser");
  }
  if (typeof window.RTCPeerConnection === "undefined") {
    issues.push("Real-time video (WebRTC) is not supported in this browser");
  }
  if (typeof HTMLCanvasElement === "undefined") {
    issues.push("Canvas is not supported in this browser");
  }
  return { compatible: issues.length === 0, issues };
}

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
  const [screenShare, setScreenShare] = useState("pending");
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

  async function requestMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicrophone("ok");
    } catch {
      setMicrophone("failed");
    }
  }

  async function requestScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setScreenShare("ok");
    } catch {
      setScreenShare("failed");
    }
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
      setSpeedStatus("ok");
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
          const res = await faceVision.analyzeFrame(canvas);
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

  const allDone =
    camera === "ok" &&
    microphone === "ok" &&
    screenShare === "ok" &&
    fullscreen === "ok" &&
    deviceCompat.status === "ok" &&
    speedStatus === "ok" &&
    identityStatus === "ok" &&
    consent;

  async function handleConfirm() {
    setSubmitting(true);
    setError("");
    try {
      await api.post(
        "/interview-portal/checks",
        {
          camera: camera === "ok",
          microphone: microphone === "ok",
          screenShare: screenShare === "ok",
          fullscreen: fullscreen === "ok",
          deviceCompatible: deviceCompat.status === "ok",
          browserInfo: navigator.userAgent,
          downloadMbps: speedMbps,
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
            <Button variant={microphone === "ok" ? "outline" : "primary"} size="sm" onClick={requestMicrophone} disabled={microphone === "ok"}>
              {microphone === "ok" ? "Microphone Enabled" : "Enable Microphone"}
            </Button>
          </CheckCard>

          <CheckCard icon={ScreenShare} title="Screen Share" state={screenShare}>
            <Button variant={screenShare === "ok" ? "outline" : "primary"} size="sm" onClick={requestScreenShare} disabled={screenShare === "ok"}>
              {screenShare === "ok" ? "Screen Share Enabled" : "Enable Screen Share"}
            </Button>
          </CheckCard>

          <CheckCard icon={Maximize} title="Fullscreen" state={fullscreen}>
            <Button variant={fullscreen === "ok" ? "outline" : "primary"} size="sm" onClick={requestFullscreen} disabled={fullscreen === "ok"}>
              {fullscreen === "ok" ? "Fullscreen Enabled" : "Enter Fullscreen"}
            </Button>
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

          <CheckCard icon={Gauge} title="Internet Speed Check" state={speedStatus === "testing" ? "pending" : speedStatus}>
            {speedMbps !== null && <p className="mb-2 text-sm text-slate-600">Estimated download speed: {speedMbps.toFixed(1)} Mbps</p>}
            <Button variant={speedStatus === "ok" ? "outline" : "primary"} size="sm" onClick={runSpeedTest} disabled={speedStatus === "testing"}>
              {speedStatus === "testing" ? "Testing…" : speedStatus === "ok" ? "Run Again" : "Run Speed Test"}
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

        {features.secondaryCam && (
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
