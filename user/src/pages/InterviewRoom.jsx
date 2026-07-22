import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, User, Send, CheckCircle2, Loader2, Mic, Square, Keyboard, Volume2, Eye, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import { getAuth, authHeader } from "../portal/portalAuth.js";
import { useVoiceInterview } from "../portal/useVoiceInterview.js";
import { useProctoring } from "../portal/useProctoring.js";
import { Card } from "../components/ui/Card.jsx";
import { Textarea } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

function Bubble({ role, text, muted }) {
  const isAi = role === "ai";
  return (
    <div className={`flex gap-2.5 ${isAi ? "" : "flex-row-reverse"}`}>
      <div
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
          (isAi ? "bg-white text-slate-700 shadow-sm" : "bg-brand-600 text-white") +
          (muted ? " opacity-70" : "")
        }
      >
        {text}
      </div>
    </div>
  );
}

export default function InterviewRoom() {
  const navigate = useNavigate();
  // The voice hook calls onAutoEndOfTurn when the candidate stops speaking (hands-free). We route
  // it through a ref so the live socket handler always invokes the latest handleDone.
  const handleDoneRef = useRef(null);
  const voice = useVoiceInterview({ onAutoEndOfTurn: () => handleDoneRef.current?.() });
  const { supported, phase, interim, speak, startListening, finishListening, cancelListening } = voice;

  const [state, setState] = useState(null);
  const [mode, setMode] = useState("voice"); // "voice" | "text"
  const [started, setStarted] = useState(false); // voice unlocked by a user gesture (autoplay)
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // --- Proctoring (integrity monitoring) ---
  const [warning, setWarning] = useState("");
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
  const { videoRef: proctorVideoRef, monitoring, start: startProctor, stop: stopProctor } = useProctoring({
    onWarn: showWarning,
    referenceDescriptor,
  });
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

  const submitAnswer = useCallback(
    async (payload) => {
      if (!payload.text || sending) return;
      setSending(true);
      setError("");
      // Optimistically show the candidate's answer while the AI thinks.
      setState((s) => (s ? { ...s, turns: [...s.turns, { role: "candidate", kind: "answer", text: payload.text }] } : s));
      setAnswer("");
      try {
        const res = await api.post("/interview-portal/interview/answer", payload, { headers: authHeader() });
        setState(res.data);
      } catch (err) {
        setError(err.response?.data?.error || "Could not submit your answer.");
        await load(); // resync on failure
      } finally {
        setSending(false);
      }
    },
    [sending, load]
  );

  // Voice orchestration: for each new AI question, speak it aloud then open the mic. The candidate
  // ends their turn with "Done". Runs only in voice mode after the start gesture.
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
        await speak(q);
        await startListening();
      } catch {
        setError("Couldn't start the microphone — you can type your answer instead.");
        setMode("text");
      } finally {
        busyRef.current = false;
      }
    })();
  }, [mode, started, state, phase, speak, startListening]);

  const handleDone = useCallback(async () => {
    if (finishingRef.current) return; // auto end-of-turn and the manual button must not both fire
    finishingRef.current = true;
    try {
      const result = await finishListening();
      if (!result?.transcript) {
        setError("I didn't catch that — please try again, or switch to typing.");
        handledRef.current = null; // allow re-opening the mic for the same question
        return;
      }
      await submitAnswer({
        text: result.transcript,
        inputMode: "voice",
        transcriptConfidence: result.confidence,
        audioDurationMs: result.durationMs,
        acoustic: result.acoustic,
      });
    } finally {
      finishingRef.current = false;
    }
  }, [finishListening, submitAnswer]);

  // Keep the ref the voice hook calls pointed at the latest handleDone.
  useEffect(() => {
    handleDoneRef.current = handleDone;
  }, [handleDone]);

  function switchToTyping() {
    cancelListening();
    setMode("text");
  }

  function handleTextSubmit(e) {
    e.preventDefault();
    submitAnswer({ text: answer.trim(), inputMode: "text" });
  }

  if (!state) {
    return (
      <Card className="text-center">
        {error ? (
          <p className="text-sm font-medium text-red-600">{error}</p>
        ) : (
          <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your interview…
          </p>
        )}
      </Card>
    );
  }

  if (state.status === "not_started") {
    return (
      <Card className="text-center">
        <h1 className="text-lg font-semibold text-slate-900">Interview not started</h1>
        <p className="mt-2 text-sm text-slate-500">Please complete your pre-interview checks first.</p>
        <Button className="mt-4" onClick={() => navigate("/portal/pre-check")}>
          Go to pre-interview checks
        </Button>
      </Card>
    );
  }

  if (state.completed) {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Interview Complete</h1>
        <p className="mt-2 text-sm text-slate-500">
          Thank you for your time. Your responses have been recorded and the hiring team will review your interview and be
          in touch about next steps.
        </p>
        <Button variant="outline" className="mt-5" onClick={() => navigate("/dashboard")}>
          Back to my dashboard
        </Button>
      </Card>
    );
  }

  const voiceMode = mode === "voice" && supported;

  return (
    <div className="space-y-4">
      {/* Live integrity warning (enforcement = warn) */}
      {warning && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {warning}
        </div>
      )}

      {/* Self-view — kept mounted so the monitor can attach its stream; a quiet reminder the
          session is proctored. */}
      <div className={monitoring ? "fixed bottom-4 right-4 z-40" : "hidden"}>
        <video
          ref={proctorVideoRef}
          autoPlay
          muted
          playsInline
          className="h-24 w-32 rounded-lg border-2 border-white/80 bg-slate-900 object-cover shadow-lg"
        />
        <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <Eye className="h-2.5 w-2.5" /> Monitored
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Interview</h1>
          <p className="mt-1 text-sm text-slate-500">
            {voiceMode
              ? "Speak your answers naturally — I'm listening. There's no time pressure."
              : "Answer each question in your own words. There's no time pressure — take a moment to think."}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          Question {Math.min(state.questionCount, state.maxQuestions)} / {state.maxQuestions}
        </span>
      </div>

      <Card className="p-0">
        <div ref={scrollRef} className="max-h-[52vh] space-y-4 overflow-y-auto bg-slate-50 p-5">
          {state.turns.map((t, i) => (
            <Bubble key={i} role={t.role} text={t.text} />
          ))}
          {voiceMode && phase === "listening" && interim && <Bubble role="candidate" text={interim} muted />}
          {sending && (
            <div className="flex items-center gap-2 pl-11 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Interviewer is thinking…
            </div>
          )}
        </div>

        {/* --- Answer controls --- */}
        <div className="border-t border-slate-100 p-4">
          {error && <p className="mb-2 text-xs font-medium text-red-600">{error}</p>}

          {voiceMode ? (
            !started ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-slate-500">This is a spoken interview. Click below to begin — I'll ask each question aloud.</p>
                <Button size="lg" onClick={() => setStarted(true)}>
                  <Mic className="h-4 w-4" /> Start voice interview
                </Button>
                <button type="button" onClick={switchToTyping} className="text-xs font-medium text-slate-400 hover:text-slate-600">
                  or type my answers instead
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-1">
                {phase === "speaking" && (
                  <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
                    <Volume2 className="h-4 w-4 animate-pulse" /> Interviewer is speaking…
                  </p>
                )}
                {phase === "listening" && (
                  <>
                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      Listening — speak your answer
                    </p>
                    <p className="text-xs text-slate-400">I'll move on automatically when you pause — or tap Done.</p>
                    <Button size="lg" variant="danger" onClick={handleDone}>
                      <Square className="h-4 w-4" /> Done answering
                    </Button>
                  </>
                )}
                {phase === "processing" && (
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Transcribing your answer…
                  </p>
                )}
                {phase === "idle" && !sending && (
                  <p className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Preparing the next question…
                  </p>
                )}
                <button type="button" onClick={switchToTyping} className="text-xs font-medium text-slate-400 hover:text-slate-600">
                  <Keyboard className="mr-1 inline h-3 w-3" /> Switch to typing
                </button>
              </div>
            )
          ) : (
            <form onSubmit={handleTextSubmit}>
              <Textarea
                rows={3}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer…"
                disabled={sending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleTextSubmit(e);
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">Press Ctrl/⌘ + Enter to send</span>
                  {supported && (
                    <button
                      type="button"
                      onClick={() => { setMode("voice"); setError(""); }}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
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
