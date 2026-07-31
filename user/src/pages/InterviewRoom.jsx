import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  User,
  Send,
  CheckCircle2,
  Loader2,
  Mic,
  Square,
  Keyboard,
  Volume2,
  Eye,
  EyeOff,
  Info,
  RotateCcw,
} from "lucide-react";
import api from "../api/client.js";
import { getAuth, authHeader } from "../portal/portalAuth.js";
import { useVoiceInterview } from "../portal/useVoiceInterview.js";
import { useProctoring } from "../portal/useProctoring.js";
import { Card, Skeleton } from "../components/ui/Card.jsx";
import { Textarea } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";
import InterviewShell from "../components/portal/InterviewShell.jsx";

function Bubble({ role, text, muted }) {
  const isAi = role === "ai";
  return (
    <div className={`flex gap-2.5 ${isAi ? "" : "flex-row-reverse"}`}>
      <div
        aria-hidden="true"
        className={
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
          (isAi ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-600")
        }
      >
        {isAi ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div
        className={
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm " +
          (isAi ? "bg-white text-slate-700 shadow-card" : "bg-brand-600 text-white") +
          (muted ? " opacity-70" : "")
        }
      >
        <span className="sr-only">{isAi ? "Interviewer: " : "You: "}</span>
        {text}
      </div>
    </div>
  );
}

// Mirrors backend/services/aiInterviewService.js's MAX_ANSWER_CHARS — the server silently
// truncates past this, so the field enforces the same limit instead of letting a candidate
// type past a wall they can't see.
const MAX_ANSWER_CHARS = 4000;

// A typed-but-unsent draft survives a refresh or crash. Single fixed key: only one interview
// session is ever active in a browser tab at a time (matches the "proctorRefDescriptor" pattern
// used elsewhere in the portal).
const DRAFT_KEY = "interviewDraftAnswer";

function readDraft() {
  try {
    return sessionStorage.getItem(DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

function writeDraft(text) {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable (private mode, quota) — draft recovery is best-effort */
  }
}

export default function InterviewRoom() {
  const navigate = useNavigate();
  // The voice hook calls onAutoEndOfTurn when the candidate stops speaking (hands-free). We route
  // it through a ref so the live socket handler always invokes the latest handleDone.
  const handleDoneRef = useRef(null);
  const voice = useVoiceInterview({ onAutoEndOfTurn: () => handleDoneRef.current?.() });
  const {
    supported,
    phase,
    interim,
    error: voiceError,
    endingSoon,
    backchannel,
    personaName,
    askAndListen,
    acknowledge,
    finishListening,
    cancelListening,
  } = voice;

  // Barge-in is only on where the pre-check MEASURED that this device's mic doesn't hear its own
  // speakers, and the decision came from the server, not from this page. Anywhere else the
  // interviewer finishes each question before listening — otherwise it hears itself start talking
  // and stops mid-question, every question.
  const bargeIn = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("bargeIn") || "null")?.eligible === true;
    } catch {
      return false;
    }
  }, []);

  const [state, setState] = useState(null);
  // Start in text mode if a recovered draft exists, so it's visible immediately instead of
  // hidden behind a manual "switch to typing" tap.
  const [mode, setMode] = useState(() => (readDraft() ? "text" : "voice")); // "voice" | "text"
  const [started, setStarted] = useState(false); // voice unlocked by a user gesture (autoplay)
  const [answer, setAnswer] = useState(readDraft);
  // The most recent submit attempt that hasn't been confirmed sent yet. Kept OUTSIDE state.turns
  // so a failed submit never overwrites real server state — the previous version optimistically
  // mutated state.turns, and a resync on failure silently erased the candidate's answer.
  const [pending, setPending] = useState(null); // { text, payload, status: "sending"|"failed"|"expired" }
  const [error, setError] = useState("");
  const sending = pending?.status === "sending";
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // --- Proctoring (integrity monitoring) ---
  const [warning, setWarning] = useState("");
  // Hides the self-view preview only — monitoring keeps running underneath. A candidate distracted
  // by their own face otherwise has no recourse (nothing else on this screen is optional).
  const [pipHidden, setPipHidden] = useState(false);
  const warnTimerRef = useRef(null);
  const showWarning = useCallback((msg) => {
    setWarning(msg);
    clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarning(""), 4500);
  }, []);
  const referenceDescriptor = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("proctorRefDescriptor") || "null");
    } catch {
      return null;
    }
  }, []);
  // Phase 14.2 — evidence-clip capture runs only when the tenant enables it AND
  // the candidate consented at pre-check (recorded there, mirrored here so the
  // buffer never even starts otherwise; the server re-enforces consent anyway).
  const evidenceCapture = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("evidenceCapture") || "null") || { enabled: false, consented: false };
    } catch {
      return { enabled: false, consented: false };
    }
  }, []);
  const { videoRef: proctorVideoRef, monitoring, start: startProctor, stop: stopProctor } = useProctoring({
    onWarn: showWarning,
    referenceDescriptor,
    evidence: evidenceCapture,
  });
  // Esc can't be intercepted by page JS in any browser (a deliberate security boundary so no page
  // can trap a user in fullscreen) — the honest fix is making the exit immediately actionable instead
  // of a toast that scrolls by. `useProctoring`'s own `fullscreen_exit` detection/logging is unchanged;
  // this is a separate, purely-UI observation of the same DOM signal, gated on `monitoring` so it's
  // only live while proctoring actually is.
  const [fullscreenLost, setFullscreenLost] = useState(false);
  useEffect(() => {
    if (!monitoring) { setFullscreenLost(false); return; }
    const onChange = () => setFullscreenLost(!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [monitoring]);
  const reenterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Declined/unsupported — the banner just stays up; nothing else to do about it.
    }
  }, []);
  const scrollRef = useRef(null);
  const handledRef = useRef(null); // question text we've already spoken/opened the mic for
  const busyRef = useRef(false);
  const finishingRef = useRef(false); // guards double-submit (auto end-of-turn vs the manual "Done")

  const load = useCallback(async () => {
    try {
      const res = await api.get("/interview-portal/interview", { headers: authHeader() });
      setState(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load your interview.");
    }
  }, []);

  useEffect(() => {
    if (!getAuth()?.jwt) {
      navigate("/portal/dashboard", { replace: true });
      return;
    }
    load();
  }, [navigate, load]);

  // Fall back to typing if the browser can't do real-time voice.
  useEffect(() => {
    if (!supported) setMode("text");
  }, [supported]);

  // Start integrity monitoring while the interview is live; stop when it completes (the hook also
  // tears down on unmount). start()/stop() are idempotent, so re-runs are safe.
  useEffect(() => {
    if (!state) return;
    const active = !state.completed && state.status !== "not_started";
    if (active) startProctor();
  }, [state?.status, state?.completed, startProctor]);

  useEffect(() => {
    if (state?.completed) stopProctor();
  }, [state?.completed, stopProctor]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [state?.turns?.length, interim]);

  // Warn before an accidental tab close / refresh / typed-URL navigation during a live,
  // unrepeatable proctored session. Doesn't catch in-app link clicks (browser SPA navigation
  // doesn't fire beforeunload) — that requires removing the surrounding app chrome, tracked
  // separately.
  useEffect(() => {
    const active = !!state && !state.completed && state.status !== "not_started";
    if (!active) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  // Surface voice-pipeline errors (e.g. a dropped socket) through the same slot the rest of the
  // room's errors render in — previously read but never displayed, so a disconnect left the
  // "Listening" indicator pulsing over a dead connection with no visible explanation.
  useEffect(() => {
    if (voiceError) setError(voiceError);
  }, [voiceError]);

  // Persist the typed draft as the candidate types, independent of submit state, so a refresh
  // or crash mid-answer doesn't lose it. Cleared on confirmed send (submitAnswer / draft init).
  const updateAnswer = useCallback((value) => {
    setAnswer(value);
    writeDraft(value);
  }, []);

  const submitAnswer = useCallback(
    async (payload) => {
      if (!payload.text || pending?.status === "sending") return;
      setError("");
      // Shown immediately as a pending bubble (see render) — never written into state.turns, so
      // a failure can't erase real server state by resyncing over it.
      setPending({ text: payload.text, payload, status: "sending" });
      setAnswer("");
      writeDraft(""); // clear the recovery draft; `pending` now carries the in-flight copy
      const preCount = stateRef.current?.questionCount ?? 0;
      try {
        const res = await api.post("/interview-portal/interview/answer", payload, { headers: authHeader() });
        setState(res.data);
        setPending(null);
      } catch (err) {
        if (err.response?.status === 401) {
          setError("This interview link has expired. Please check your email for a current invitation.");
          setPending((p) => (p ? { ...p, status: "expired" } : p));
          return;
        }
        setError(err.response?.data?.error || "Couldn't send that — check your connection and try again.");
        // The request may have actually reached the server even though the response was lost
        // (timeout, dropped connection). Resync once — if the question already advanced, the
        // "failed" answer went through and there's nothing to retry.
        try {
          const fresh = await api.get("/interview-portal/interview", { headers: authHeader() });
          setState(fresh.data);
          if (fresh.data.questionCount > preCount || fresh.data.completed) {
            setPending(null);
            setError("");
            return;
          }
        } catch {
          /* resync is best-effort; the retry bubble below is the fallback either way */
        }
        setPending((p) => (p ? { ...p, status: "failed" } : p));
      }
    },
    [pending]
  );

  const voiceMode = mode === "voice" && supported;

  // Voice orchestration: for each new AI question, ask it and listen. On devices where the
  // pre-check measured an isolated mic the two overlap, so the candidate can cut in mid-question;
  // elsewhere the question finishes first. Either way the turn ends on a pause or on "Done".
  // Runs only in voice mode after the start gesture.
  useEffect(() => {
    if (mode !== "voice" || !started || !state) return;
    if (state.completed || state.status === "not_started") return;
    const q = state.currentQuestion;
    if (!q || handledRef.current === q || busyRef.current) return;
    if (phase !== "idle") return;
    busyRef.current = true;
    handledRef.current = q;
    (async () => {
      try {
        await askAndListen(q, { bargeIn });
      } catch {
        setError("Couldn't start the microphone — you can type your answer instead.");
        setMode("text");
      } finally {
        busyRef.current = false;
      }
    })();
  }, [mode, started, state, phase, askAndListen, bargeIn]);

  // Watchdog: `phase === "idle"` while voice mode is armed should always be momentary (the
  // orchestration effect above immediately re-arms it). If it isn't — the effect bailed because
  // handledRef still pointed at the current question, most commonly after switching typing ->
  // voice mid-question — the candidate was previously left staring at a "Preparing the next
  // question…" spinner that never resolved. Surface a real, actionable error instead.
  useEffect(() => {
    if (!voiceMode || !started || phase !== "idle" || sending || pending) return;
    const t = setTimeout(() => {
      setError("This is taking longer than it should. Try switching to typing, or reload the page.");
    }, 20000);
    return () => clearTimeout(t);
  }, [voiceMode, started, phase, sending, pending]);

  const handleDone = useCallback(async () => {
    if (finishingRef.current) return; // auto end-of-turn and the manual button must not both fire
    finishingRef.current = true;
    try {
      const result = await finishListening();
      if (!result?.transcript) {
        setError("That didn't come through — please try again, or switch to typing.");
        handledRef.current = null; // allow re-opening the mic for the same question
        return;
      }
      // Say "thank you" out loud while the next question is being prepared, instead of leaving
      // the candidate in dead air. Non-blocking, and the event is attributed to THIS answer
      // rather than the next one by sending it along with the submit.
      const ack = acknowledge();
      await submitAnswer({
        text: result.transcript,
        inputMode: "voice",
        transcriptConfidence: result.confidence,
        audioDurationMs: result.durationMs,
        acoustic: result.acoustic,
        // Lets the server strip any of the interviewer's own words the mic picked up, and record
        // the interview's real conversational conditions. Server-validated against its own
        // approved bank — arbitrary strings are ignored.
        backchannels: [...(result.backchannels || []), ...(ack ? [ack] : [])],
        // How many times this question had to be repeated. Recorded as a condition of the
        // interview; no scorer reads it (see backend/utils/repeatIntent.js).
        repeatCount: result.repeatCount,
        // Whether the question was finished before they started answering. A question the candidate
        // talked over was not fully asked, and the server must not count it as probe coverage.
        questionDelivery: result.questionDelivery,
      });
    } finally {
      finishingRef.current = false;
    }
  }, [finishListening, submitAnswer, acknowledge]);

  // Keep the ref the voice hook calls pointed at the latest handleDone.
  useEffect(() => {
    handleDoneRef.current = handleDone;
  }, [handleDone]);

  function switchToTyping() {
    // Carry over whatever was heard so far rather than silently discarding it — the candidate
    // may have been mid-sentence when they decided to switch.
    if (interim && !answer) updateAnswer(interim);
    cancelListening();
    setMode("text");
  }

  // Voice consent (Phase 9.5): the server won't mint a streaming token until
  // consent is recorded, so acceptance must round-trip before the mic opens.
  const [consentBusy, setConsentBusy] = useState(false);
  async function acceptVoiceConsent() {
    setConsentBusy(true);
    try {
      await api.post("/interview-portal/voice/consent", { given: true }, { headers: authHeader() });
      setStarted(true);
    } catch {
      setError("Couldn't record your voice consent — you can type your answers instead.");
      setMode("text");
    } finally {
      setConsentBusy(false);
    }
  }
  function declineVoiceConsent() {
    // Record the decline (best-effort) and fall back to typing — never penalised.
    api.post("/interview-portal/voice/consent", { given: false }, { headers: authHeader() }).catch(() => {});
    switchToTyping();
  }

  function switchToVoice() {
    // Without this, handledRef still points at the current question from before the switch, so
    // the orchestration effect thinks it already handled it and never reopens the mic — the room
    // was left showing a "Preparing the next question…" spinner that never resolved.
    handledRef.current = null;
    setError("");
    setMode("voice");
  }

  function handleTextSubmit(e) {
    e.preventDefault();
    if (!answer.trim()) return;
    submitAnswer({ text: answer.trim(), inputMode: "text" });
  }

  // Drives InterviewShell's exit-confirmation copy: only warn about ending a "monitored session"
  // while one is actually running. Wrapped once below rather than per-branch so this stays the
  // single source of truth for it.
  const live = !!state && !state.completed && state.status !== "not_started";

  let body;
  if (!state) {
    body = error ? (
      <Card className="text-center">
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      </Card>
    ) : (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Card className="space-y-4 p-5">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-10 w-1/2" />
        </Card>
      </div>
    );
  } else if (state.status === "not_started") {
    body = (
      <Card className="text-center">
        <h1 className="text-lg font-semibold text-slate-900">Interview not started</h1>
        <p className="mt-2 text-sm text-slate-500">Please complete your pre-interview checks first.</p>
        <Button className="mt-4" onClick={() => navigate("/portal/pre-check")}>
          Go to pre-interview checks
        </Button>
      </Card>
    );
  } else if (state.completed) {
    body = (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Interview Complete</h1>
        <p className="mt-2 text-sm text-slate-500">
          Thank you for your time. Your responses have been recorded and the hiring team will review your interview and be
          in touch about next steps.
        </p>
        <Button variant="outline" className="mt-5" onClick={() => navigate("/portal/dashboard")}>
          Back to my dashboard
        </Button>
      </Card>
    );
  } else {
    body = (
    <div className="space-y-4">
      {/* Proctoring nudge — reported as an observation, not an accusation (DESIGN.md: no surveillance
          framing). Brand-toned, matching the "in-progress" meaning the rest of the system reserves
          for it; amber/red are spoken for by the Reserved Verdict Rule and would misread this as a
          pipeline outcome. */}
      {fullscreenLost && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800"
        >
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" /> You've exited fullscreen — please return to continue your interview.
          </span>
          <Button size="sm" onClick={reenterFullscreen}>Return to fullscreen</Button>
        </div>
      )}

      {warning && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800"
        >
          <Info className="h-4 w-4 shrink-0" /> {warning}
        </div>
      )}

      {/* Degraded-engine disclosure — never let a fallback pass silently as if it were the real
          evaluation (PRODUCT.md: uncertainty must be visible everywhere it surfaces). Neutral
          tone, deliberately not the amber/red channel reserved for verdicts and integrity. */}
      {state.engine === "fallback" && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <Info className="h-4 w-4 shrink-0 text-slate-400" />
          This interview is running on a standard question set right now. Your answers are still recorded and reviewed the
          same way.
        </div>
      )}

      {/* Self-view — kept mounted so the monitor can attach its stream; a quiet reminder the
          session is proctored. Anchored top-right (below the sticky header) rather than
          bottom-right so it never sits over "Send answer" / "Done answering" on a phone.
          Hide/show only toggles the preview — the stream and monitoring keep running underneath. */}
      <div className={monitoring ? "fixed top-16 right-4 z-40" : "hidden"}>
        {pipHidden ? (
          <button
            type="button"
            onClick={() => setPipHidden(false)}
            className="flex items-center gap-1.5 rounded-lg border-2 border-white/80 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
          >
            <Eye className="h-3 w-3" aria-hidden="true" /> Show camera preview
          </button>
        ) : (
          <div className="relative">
            <video
              ref={proctorVideoRef}
              autoPlay
              muted
              playsInline
              aria-hidden="true"
              className="h-20 w-28 rounded-lg border-2 border-white/80 bg-slate-900 object-cover shadow-soft sm:h-24 sm:w-32"
            />
            <span
              aria-hidden="true"
              className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white"
            >
              <Eye className="h-2.5 w-2.5" /> Monitored
            </span>
            <button
              type="button"
              onClick={() => setPipHidden(true)}
              aria-label="Hide camera preview"
              className="absolute right-1 top-1 rounded bg-black/55 p-1.5 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Interview</h1>
          <p className="mt-1 text-sm text-slate-500">
            {voiceMode
              ? "Speak your answers naturally. Take your time — pausing to think won't end your turn, and you can ask for a question to be repeated."
              : "Answer each question in your own words. There's no time pressure — take a moment to think."}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          Question {Math.min(state.questionCount, state.maxQuestions)} / {state.maxQuestions}
        </span>
      </div>

      <Card className="p-0">
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="max-h-[52vh] space-y-4 overflow-y-auto bg-slate-50 p-5"
        >
          {state.turns.map((t, i) => (
            <Bubble key={i} role={t.role} text={t.text} />
          ))}
          {voiceMode && phase === "listening" && interim && <Bubble role="candidate" text={interim} muted />}

          {pending?.status === "sending" && (
            <>
              <Bubble role="candidate" text={pending.text} muted />
              <div className="flex items-center gap-2 pl-11 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Interviewer is thinking…
              </div>
            </>
          )}

          {pending?.status === "failed" && (
            <div>
              <Bubble role="candidate" text={pending.text} />
              <div className="mt-1.5 flex items-center gap-3 pl-11 text-xs">
                <span className="font-semibold text-red-600">Not sent</span>
                <button
                  type="button"
                  onClick={() => submitAnswer(pending.payload)}
                  className="flex items-center gap-1 rounded py-1 font-semibold text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                >
                  <RotateCcw className="h-3 w-3" /> Retry
                </button>
              </div>
            </div>
          )}

          {pending?.status === "expired" && (
            <div>
              <Bubble role="candidate" text={pending.text} />
              <p className="mt-1.5 pl-11 text-xs font-semibold text-red-600">Not sent — this interview link has expired</p>
            </div>
          )}
        </div>

        {/* --- Answer controls --- */}
        <div className="border-t border-slate-100 p-4">
          {error && (
            <p role="alert" className="mb-2 text-xs font-medium text-red-600">
              {error}
            </p>
          )}

          {voiceMode ? (
            !started ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-slate-500">
                  This is a spoken interview — each question will be read aloud. You can switch to typing at any point;
                  it won't affect your evaluation.
                </p>
                {/* Voice consent notice (Phase 9.5) — shown BEFORE the mic ever opens.
                    Starting is the explicit consent action; the server refuses a
                    streaming token until consent is recorded. */}
                <p className="max-w-md text-xs text-slate-400">
                  By starting, you consent to your voice being captured and transcribed in real time by a third-party
                  speech service (Deepgram) to record your answers. Audio is streamed for transcription and not stored by
                  this platform — only the text transcript is kept. If you&apos;d rather not, typing your answers is always
                  available and is evaluated identically.
                </p>
                <Button size="lg" loading={consentBusy} onClick={acceptVoiceConsent}>
                  <Mic className="h-4 w-4" /> Agree &amp; start voice interview
                </Button>
                <button
                  type="button"
                  onClick={declineVoiceConsent}
                  className="rounded py-1 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                >
                  no thanks — I&apos;ll type my answers instead
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-1">
                <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
                  {phase === "speaking" && (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
                        <Volume2 className="h-4 w-4 animate-pulse" />{" "}
                        {personaName ? `${personaName} is speaking…` : "Interviewer is speaking…"}
                      </p>
                      {bargeIn && (
                        <p className="text-xs text-slate-500">You can start answering whenever you&apos;re ready — just talk.</p>
                      )}
                    </>
                  )}
                  {/* What the interviewer just said out loud, shown as well as spoken — a candidate
                      who is deaf or hard of hearing, or on a device with no audio, must still get
                      "take your time" rather than silence. Rendered in the live status region and
                      deliberately NOT as a chat bubble: a backchannel is not a question and must
                      never be mistakable for one in the transcript. */}
                  {backchannel && (
                    <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
                      <Volume2 className="h-4 w-4 animate-pulse" /> &ldquo;{backchannel}&rdquo;
                    </p>
                  )}
                  {phase === "listening" && !backchannel && (
                    <p
                      className={`flex items-center gap-2 text-sm font-medium ${
                        endingSoon ? "text-brand-700" : "text-emerald-700"
                      }`}
                    >
                      <span className="relative flex h-2.5 w-2.5">
                        <span
                          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                            endingSoon ? "bg-brand-400" : "bg-emerald-400"
                          }`}
                        />
                        <span
                          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                            endingSoon ? "bg-brand-500" : "bg-emerald-500"
                          }`}
                        />
                      </span>
                      {endingSoon ? "Still there? Keep talking to continue." : "Listening — speak your answer"}
                    </p>
                  )}
                  {phase === "listening" && !backchannel && (
                    <p className="text-xs text-slate-500">
                      {endingSoon
                        ? "Your answer will be submitted in a few seconds unless you keep talking."
                        : "Pause when you're finished — there's no hurry. Say “could you repeat that?” to hear the question again, or tap Done."}
                    </p>
                  )}
                  {phase === "processing" && !backchannel && (
                    <p className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Transcribing your answer…
                    </p>
                  )}
                  {phase === "idle" && !backchannel && !sending && !pending && (
                    <p className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Preparing the next question…
                    </p>
                  )}
                  {phase === "idle" && pending?.status === "failed" && (
                    <p className="text-sm text-slate-600">
                      Your answer didn't send — tap <span className="font-semibold">Retry</span> above, or switch to typing.
                    </p>
                  )}
                  {phase === "idle" && pending?.status === "expired" && (
                    <p className="text-sm font-medium text-red-600">This interview link has expired.</p>
                  )}
                </div>
                {phase === "listening" && (
                  <Button size="lg" onClick={handleDone}>
                    <Square className="h-4 w-4" /> Done answering
                  </Button>
                )}
                <button
                  type="button"
                  onClick={switchToTyping}
                  className="rounded py-1 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                >
                  <Keyboard className="mr-1 inline h-3 w-3" /> Switch to typing
                </button>
              </div>
            )
          ) : (
            <form onSubmit={handleTextSubmit}>
              <Textarea
                rows={3}
                value={answer}
                onChange={(e) => updateAnswer(e.target.value)}
                placeholder="Type your answer…"
                disabled={sending}
                maxLength={MAX_ANSWER_CHARS}
                aria-label="Your answer"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleTextSubmit(e);
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">Press Ctrl/⌘ + Enter to send</span>
                  {answer.length > MAX_ANSWER_CHARS - 500 && (
                    <span className={`text-xs ${answer.length >= MAX_ANSWER_CHARS ? "font-semibold text-red-600" : "text-slate-500"}`}>
                      {answer.length} / {MAX_ANSWER_CHARS}
                    </span>
                  )}
                  {supported && (
                    <button
                      type="button"
                      onClick={switchToVoice}
                      className="rounded py-1 text-xs font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                    >
                      <Mic className="mr-1 inline h-3 w-3" /> Use voice instead
                    </button>
                  )}
                </div>
                <Button type="submit" loading={sending} disabled={!answer.trim()}>
                  <Send className="h-4 w-4" /> Send answer
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
    );
  }

  return <InterviewShell stage={live ? "live" : "setup"}>{body}</InterviewShell>;
}
