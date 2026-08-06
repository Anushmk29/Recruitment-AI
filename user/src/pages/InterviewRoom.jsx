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
import { useLiveKitInterview } from "../portal/useLiveKitInterview.js";
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
  // The candidate said something ABOUT the interview — they can't answer this one, or they want
  // to stop. Same ref indirection as onAutoEndOfTurn: the live socket handler is installed once.
  const handleActRef = useRef(null);
  const voice = useVoiceInterview({
    onAutoEndOfTurn: () => handleDoneRef.current?.(),
    onDialogueAct: (payload) => handleActRef.current?.(payload),
  });
  const {
    supported,
    phase,
    interim,
    error: voiceError,
    endingSoon,
    backchannel,
    personaName,
    canInterrupt,
    connection,
    endsAt,
    speakingBetweenTurns,
    keepListening,
    speak,
    askAndListen,
    acknowledge,
    acknowledgeDecline,
    finishListening,
    cancelListening,
  } = voice;

  // Whether the spoken greeting has already played on this mount. Paired with a "no answers yet"
  // check at the call site, because a ref resets on remount and a reload mid-interview must not
  // re-introduce the interviewer.
  const introSpokenRef = useRef(false);

  // Whether the pre-check MEASURED that this device's mic doesn't hear its own speakers.
  //
  // This used to be the sole gate on being able to interrupt, which meant every candidate without
  // headphones got an interviewer they could not talk over. It is now one input of two: the hook
  // enables interruption whenever the server's echo gate is on (portal/echoAlignment.js), and this
  // measurement only still matters if that gate has been switched off. `canInterrupt` from the
  // hook is the real answer, and it is what the UI should tell the candidate.
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

  // The interview is over — stop monitoring, and CLOSE THE MICROPHONE.
  //
  // The mic close is not optional housekeeping. The session now persists across turns (it used to
  // be torn down after every answer), so when the last answer went in there was nothing left to
  // close it: the candidate's microphone would have stayed live, streaming to a transcription
  // service, after the interview had visibly ended. That is the single worst thing this refactor
  // could have left behind, and it is exactly the kind of thing nobody notices because everything
  // on screen looks finished.
  useEffect(() => {
    if (!state?.completed) return;
    stopProctor();
    try {
      cancelListening();
    } catch {
      /* the session may already be down — ending must never depend on it */
    }
  }, [state?.completed, stopProctor, cancelListening]);

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

  // Seconds remaining before the turn ends, ticked once a second only while a countdown is
  // actually running — a permanent interval would re-render the room for the whole interview.
  const [secondsLeft, setSecondsLeft] = useState(null);
  useEffect(() => {
    if (!endsAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

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

  // Send a conversational act — a decline or a withdrawal. Deliberately a different endpoint from
  // submitAnswer: these are not answers and must not be scored as any. See
  // backend/utils/dialogueActs.js.
  const submitAct = useCallback(async (payload) => {
    setError("");
    try {
      const res = await api.post("/interview-portal/interview/act", payload, { headers: authHeader() });
      setState(res.data);
      setPending(null);
      return res.data;
    } catch (err) {
      if (err.response?.status === 401) {
        setError("This interview link has expired. Please check your email for a current invitation.");
        return null;
      }
      // A failed withdrawal is the one that matters: the candidate has said they want to stop and
      // the request did not land, so tell them plainly rather than leaving them in an interview
      // they have already left. The button below stays available to try again.
      setError(
        err.response?.data?.error ||
          (payload.act === "withdraw"
            ? "Couldn't end the interview just now — check your connection and try again."
            : "Couldn't send that — check your connection and try again.")
      );
      return null;
    }
  }, []);

  // The candidate declined the current question, or asked to stop and confirmed it.
  const handleDialogueAct = useCallback(
    async (event) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      try {
        const result = await finishListening();
        if (event.act === "withdraw") {
          await submitAct({
            act: "withdraw",
            text: event.text,
            confirmText: event.confirmText,
            confirmedBy: event.confirmedBy || "spoken",
          });
          return;
        }
        // A decline. Use the server-trusted transcript from the closed stream where we have it —
        // it is the same text the hook detected on, plus anything that arrived as the mic closed.
        const text = result?.transcript || event.text;
        if (!text) {
          setError("That didn't come through — please try again, or switch to typing.");
          handledRef.current = null;
          return;
        }
        // "That's no problem — let's move on", said out loud while the next question is prepared,
        // so a candidate who has just admitted they can't answer isn't met with silence.
        const ack = acknowledgeDecline();
        await submitAct({
          act: "decline",
          text,
          inputMode: "voice",
          transcriptConfidence: result?.confidence,
          audioDurationMs: result?.durationMs,
          backchannels: [...(result?.backchannels || []), ...(ack ? [ack] : [])],
        });
      } finally {
        finishingRef.current = false;
      }
    },
    [finishListening, submitAct, acknowledgeDecline]
  );

  useEffect(() => {
    handleActRef.current = handleDialogueAct;
  }, [handleDialogueAct]);

  // The explicit exit. It exists independently of the spoken one because a candidate who wants to
  // leave should never have to find the right words to be let out — and because a button press
  // needs no confirmation to be unambiguous, which the spoken path does.
  const [confirmingExit, setConfirmingExit] = useState(false);
  const endInterview = useCallback(async () => {
    setConfirmingExit(false);
    try {
      cancelListening();
    } catch {
      /* the mic may already be closed — ending must not depend on it */
    }
    await submitAct({ act: "withdraw", confirmedBy: "explicit" });
  }, [cancelListening, submitAct]);

  // ---- LiveKit realtime pipeline (LK-4) --------------------------------------
  //
  // The realtime pipeline. Off unless the tenant has it on (VOICE_MODE /
  // CompanySettings.ai.voiceMode) — `checkAvailable` answers 404 for "not enabled", which is a
  // normal answer: a tenant that has not adopted it gets the turn-based interview, including if
  // this probe fails for any other reason. The worker owns audio, evidence, and the guardrail;
  // this client is a WebRTC join, a speaker, and captions. On any end (complete, withdrawn,
  // halted, worker death) the room is closed server-side and we refetch — the server knows which
  // one happened, we never guess.
  const lk = useLiveKitInterview({
    onEnded: async () => {
      try {
        const fresh = await api.get("/interview-portal/interview", { headers: authHeader() });
        setState(fresh.data);
      } catch {
        setState((s) => (s ? { ...s, completed: true } : s));
      }
    },
  });
  const lkRef = useRef(lk);
  useEffect(() => { lkRef.current = lk; }, [lk]);

  // Ask once, before any microphone opens, so the room knows which pipeline it is running.
  useEffect(() => {
    if (!supported || lk.available !== null) return;
    void lk.checkAvailable();
  }, [supported, lk]);

  // WHICH PIPELINE IS LIVE. Declared BEFORE the effects that read them, and it has to stay that
  // way: a dependency array is evaluated during render, so an effect listing `livekitMode` above
  // this line throws "Cannot access 'livekitMode' before initialization" and takes the whole room
  // down on first paint — the interview never renders at all. `const` gives no hoisting grace here,
  // and neither does the bundler.
  // Precedence livekit → turn-based; the lower tier is defined with the negation of the tier
  // above it, so exactly one is ever true.
  const livekitMode = mode === "voice" && supported && lk.available === true;
  const voiceMode = mode === "voice" && supported && !livekitMode;

  // EXACTLY ONE PIPELINE HOLDS THE MICROPHONE. Enforced here rather than left to the render tree.
  //
  // Two orchestrators both driving a live interview is the worst failure this room can produce —
  // two open mics, two voices talking over each other, and two independent paths submitting an
  // answer for the same question. The render branches (`livekitMode ? … : voiceMode ? …`) make it
  // look impossible, but they only decide what is DRAWN; effects and callbacks are what actually
  // open microphones — so the connect/disconnect below is gated on the pipeline flags, and the
  // turn-based orchestrator reads `voiceMode`, which is defined as `... && !livekitMode` —
  // mutually exclusive by construction.
  //
  // The LiveKit failure path is self-falling-back: the 10s agent-join watchdog (and any connect
  // error) flips lk.available to false, livekitMode recomputes false on the next render, and the
  // microphone lands with the turn-based pipeline — no candidate ever waits in an empty room.
  useEffect(() => {
    const l = lkRef.current;
    if (!l) return;
    if (livekitMode && started) {
      if (l.phase === "idle") {
        void l.connect().catch(() => {
          setError("Couldn't start the live interview — switching to the standard voice interview.");
        });
      }
      return;
    }
    if (l.phase !== "idle" && l.phase !== "ended" && l.phase !== "failed") void l.disconnect();
  }, [livekitMode, started, lk.phase]);

  // Voice orchestration: for each new AI question, ask it and listen. On devices where the
  // pre-check measured an isolated mic the two overlap, so the candidate can cut in mid-question;
  // elsewhere the question finishes first. Either way the turn ends on a pause or on "Done".
  // Runs only in voice mode after the start gesture.
  useEffect(() => {
    // `voiceMode`, NOT `mode` — the two pipelines must never both be live.
    //
    // This gated on `mode === "voice"` and the realtime pipeline also runs with mode "voice", so
    // with it enabled BOTH orchestrators ran: this one opened a second microphone and spoke the
    // question through the turn-based TTS while the agent was already asking it and listening.
    // Two voices, two open mics, and two independent paths submitting an answer for the same
    // question. `voiceMode` is defined as `... && !livekitMode`, so reading it here is what makes
    // the pipelines mutually exclusive by construction rather than by coincidence.
    if (!voiceMode || !started || !state) return;
    if (state.completed || state.status === "not_started") return;
    const q = state.currentQuestion;
    if (!q || handledRef.current === q || busyRef.current) return;
    if (phase !== "idle") return;
    // They are still talking. The microphone stays open between questions now, so this is a
    // candidate adding something to the answer they just gave — "oh, and one more thing" — and
    // asking the next question over them is precisely the behaviour that made the old pipeline
    // feel like a form being read out. Wait; the effect re-runs the moment they stop.
    if (speakingBetweenTurns) return;
    busyRef.current = true;
    handledRef.current = q;
    (async () => {
      try {
        // Greet before asking, once. The intro turn has always existed and has always been
        // rendered on screen, but nothing ever spoke it — so a voice candidate was dropped
        // straight into question one by a stranger who never said who they were. Only while the
        // candidate has yet to answer anything, so reloading the page mid-interview resumes at
        // the current question instead of starting the introductions over.
        const noAnswersYet = !state.turns?.some((t) => t.role === "candidate");
        if (state.intro && noAnswersYet && !introSpokenRef.current) {
          introSpokenRef.current = true;
          await speak(state.intro);
        }
        // `currentQuestionBridges` is the server saying this question changes the subject — it
        // came from the recruiter-approved set and owes nothing to the answer just given. The
        // browser cannot tell that from the question text, which is why it is told.
        await askAndListen(q, {
          bargeIn,
          bridges: Boolean(state.currentQuestionBridges),
          // The recruiter-approved plain-language rewording of this question, when the set
          // carried one. It is what "let me put that a different way" actually delivers; without
          // it that path honestly repeats the question instead of announcing a rewording.
          restatement: state.currentQuestionRestatement || "",
        });
      } catch {
        setError("Couldn't start the microphone — you can type your answer instead.");
        setMode("text");
      } finally {
        busyRef.current = false;
      }
    })();
  }, [voiceMode, started, state, phase, speak, askAndListen, bargeIn, speakingBetweenTurns]);

  // Watchdog: `phase === "idle"` while voice mode is armed should always be momentary (the
  // orchestration effect above immediately re-arms it). If it isn't — the effect bailed because
  // handledRef still pointed at the current question, most commonly after switching typing ->
  // voice mid-question — the candidate was previously left staring at a "Preparing the next
  // question…" spinner that never resolved. Surface a real, actionable error instead.
  //
  // The message used to say "try switching to typing, or reload the page" and give the candidate
  // neither control — instructions, in an error banner, to a person twelve minutes into a
  // proctored interview they cannot repeat. `stuck` renders the two buttons instead.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!voiceMode || !started || phase !== "idle" || sending || pending) {
      setStuck(false);
      return;
    }
    const t = setTimeout(() => setStuck(true), 20000);
    return () => clearTimeout(t);
  }, [voiceMode, started, phase, sending, pending]);

  // Re-arm the microphone for the question already on screen. The usual cause of a stall is
  // `handledRef` still pointing at the current question (most often after switching to typing and
  // back), so clearing it is what actually unsticks the room — and it is worth trying before
  // suggesting a reload, which costs the candidate their place.
  const retryVoice = useCallback(() => {
    setStuck(false);
    setError("");
    handledRef.current = null;
  }, []);

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
      // The socket died mid-answer and could not be restored. Whatever arrived before it went
      // down is NOT this candidate's answer — it is the first part of one — and submitting it
      // would send a truncated transcript to be scored as if it were complete. That was the old
      // behaviour and it was invisible to everyone. Hand the turn back instead.
      if (result.connection?.lost) {
        setError(
          "The voice connection dropped part-way through that answer, so it wasn't recorded in full. " +
            "Nothing has been submitted — please answer again, or switch to typing."
        );
        handledRef.current = null; // re-open the mic for the same question
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
        // Per-speaker word counts from diarization. A measurement only — the server decides whether
        // it amounts to a second voice, and owns the resulting integrity event.
        speakers: result.speakers,
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
        // Why this turn ended — the endpointing verdict, or that they said so outright. A
        // condition of the interview, recorded so "it cut me off" is checkable afterwards.
        endOfTurn: result.endOfTurn,
        // The answer survived, but the socket dropped and came back during it — so some words
        // are missing and we know roughly how many seconds of them. Sent so the turn carries
        // that fact into the report rather than reading as a clean recording.
        connection: result.connection,
        // Anything they said in the gap before this question was asked. The microphone no longer
        // closes between turns, so this is the "oh — and one more thing" that used to be lost
        // entirely. It is NOT spliced into this answer: it followed the previous one, and filing
        // it under the wrong question would be worse than losing it. Recorded as a condition of
        // the interview so a reviewer can see it was said.
        spokeBetweenTurns: result.spokeBetweenTurns,
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
  } else if (state.halted || lk.halted) {
    // WE stopped this, not them. Everything on this screen follows from that: no "unfortunately",
    // no explanation of what the interviewer said (repeating an unlawful question in order to
    // apologise for it is worse than the original), and an explicit promise that it will not count
    // against them — which is enforced, not just said: reviewRequiredReason withholds the
    // recommendation and computeVerdict cannot return an adverse verdict for a halted interview.
    body = (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          <Info className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Interview stopped</h1>
        <p className="mt-2 text-sm text-slate-500">
          {lk.haltMessage ||
            "We've had to stop this interview early for a technical reason on our side. This is not about your answers, and it will not count against you. A member of the hiring team will review your application and be in touch about next steps."}
        </p>
        <Button variant="outline" className="mt-5" onClick={() => navigate("/portal/dashboard")}>
          Back to my dashboard
        </Button>
      </Card>
    );
  } else if (state.endedEarly) {
    // A distinct screen from "Interview Complete", because telling someone who deliberately
    // stopped that they completed something is both false and faintly insulting. Neutral tone
    // throughout: no "unfortunately", no implication their application is over — what happens to
    // it is the hiring team's decision, not this machine's to announce. Nothing here asks them to
    // reconsider, which is the whole point of an exit that is honoured without negotiation.
    body = (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Interview ended</h1>
        <p className="mt-2 text-sm text-slate-500">
          You've ended this interview. Everything you said has been recorded and will go to the hiring team along with
          your application, and a person will review it. Nothing further is needed from you.
        </p>
        <Button variant="outline" className="mt-5" onClick={() => navigate("/portal/dashboard")}>
          Back to my dashboard
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

      {/* Self-view — a quiet reminder the session is proctored. Anchored top-right (below the
          sticky header) rather than bottom-right so it never sits over "Send answer" / "Done
          answering" on a phone.

          The <video> element is ALWAYS mounted, and hiding only collapses it to a zero-size,
          non-visible box. It used to be swapped out for the "show preview" button — which unmounted
          it, nulled the ref React had handed the proctor, and killed face detection for the rest of
          the session. Re-showing then mounted a NEW element with no srcObject (the stream is
          attached once, at monitor start), so the preview stayed black and vision never came back.
          Anything that unmounts this element silently disables monitoring; keep it mounted. */}
      <div className={monitoring ? "fixed top-16 right-4 z-40" : "hidden"}>
        <div className={pipHidden ? "relative h-0 w-0 overflow-hidden" : "relative"}>
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
        {pipHidden && (
          <button
            type="button"
            onClick={() => setPipHidden(false)}
            className="flex items-center gap-1.5 rounded-lg border-2 border-white/80 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
          >
            <Eye className="h-3 w-3" aria-hidden="true" /> Show camera preview
          </button>
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
          {/* The opening self-introduction is not one of the counted questions, so it is named
              rather than numbered — "Question 0 / 8" reads like something has gone wrong. */}
          {state.currentIsWarmup
            ? "Introduction"
            : `Question ${Math.min(state.questionCount, state.maxQuestions)} / ${state.maxQuestions}`}
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
          {/* In a spoken interview the candidate sees the QUESTIONS only. Watching your own
              words appear as you say them turns a conversation into a dictation exercise —
              people start editing themselves against the screen instead of talking. The full
              verbatim transcript is not lost: it is on the session and appears in the AI report
              the recruiter reads. Typed interviews are unchanged, because there the text IS how
              the candidate answers. */}
          {state.turns.map((t, i) =>
            (voiceMode || livekitMode) && (t.role === "candidate" || t.kind === "warmup_answer") ? null : (
              <Bubble key={i} role={t.role} text={t.text} />
            )
          )}

          {/* What the interviewer is saying, shown as well as spoken. In realtime mode this is the
              live caption from the agent's own transcript — a candidate who is deaf or hard of
              hearing, or whose audio output has failed, must still receive the question. */}
          {livekitMode && lk.caption && <Bubble role="ai" text={lk.caption} />}

          {/* The indicator must never claim to be listening when it isn't. It used to keep
              pulsing green over a socket that had already died, which is how a truncated answer
              reached the recruiter looking like a complete one. */}
          {voiceMode && connection === "reconnecting" && (
            <div
              className="flex items-center gap-2 pl-11 text-xs font-medium text-amber-600"
              role="status"
              aria-live="assertive"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Reconnecting — hold on a moment before you carry on.
            </div>
          )}

          {voiceMode && phase === "listening" && connection !== "reconnecting" && (
            <div className="flex flex-wrap items-center gap-2 pl-11 text-xs font-medium text-slate-500">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
              </span>
              {/* The countdown used to be the words "Wrapping up your answer…" over a timer nobody
                  could see, which is the whole substance of "it cut me off" — the turn ended on a
                  deadline that was never shown while the candidate was drawing breath for the rest
                  of it. Showing the seconds costs nothing and turns an ambush into something they
                  can act on, which is what the button next to it is for. */}
              {endingSoon ? (
                <>
                  <span>Ending in {secondsLeft ?? 0}s</span>
                  <button
                    type="button"
                    onClick={keepListening}
                    className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-brand-400 hover:text-brand-700"
                  >
                    I'm still thinking
                  </button>
                </>
              ) : (
                "Listening…"
              )}
              {/* Sighted candidates get the indicator; screen-reader users would otherwise have
                  no feedback at all that they are being heard, so they keep the words. */}
              <span className="sr-only">{interim}</span>
            </div>
          )}

          {pending?.status === "sending" && (
            <>
              {!voiceMode && <Bubble role="candidate" text={pending.text} muted />}
              <div className="flex items-center gap-2 pl-11 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Interviewer is thinking…
              </div>
            </>
          )}

          {/* The room has stalled. Two buttons rather than two instructions: this is a person
              partway through a proctored interview they cannot sit again, and telling them to
              "reload the page" while giving them nothing to press is the least useful thing this
              screen could do. Re-arming comes first because it is what usually fixes it and it
              costs them nothing. */}
          {stuck && (
            <div
              className="ml-11 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              role="status"
              aria-live="polite"
            >
              <p className="font-medium">This is taking longer than it should.</p>
              <p className="mt-1 text-amber-800">
                Your answers so far are saved. Try the microphone again, or switch to typing — typed
                answers are assessed the same way.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={retryVoice}
                  className="rounded-full bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700"
                >
                  Try the microphone again
                </button>
                <button
                  type="button"
                  onClick={switchToTyping}
                  className="rounded-full border border-amber-300 px-3 py-1 font-semibold text-amber-900 hover:border-amber-500"
                >
                  Switch to typing
                </button>
              </div>
            </div>
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

          {livekitMode ? (
            /* Realtime: one continuous conversation. There is no Done button and no per-question
               control, because there are no turns to control — the interviewer hears and responds
               the way a person on a call does. Interrupt it, ask it to repeat, tell it you don't
               know, tell it you want to stop: all of that is just talking. */
            !started ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-slate-500">
                  This is a live spoken interview — you and the interviewer can talk normally. Interrupt whenever you
                  like, ask for a question again, or say you&apos;d rather skip one. You can switch to typing at any
                  point; it won&apos;t affect your evaluation.
                </p>
                <p className="max-w-md text-xs text-slate-400">
                  By starting, you consent to your voice being captured and processed in real time by third-party
                  speech services (Deepgram, carried over LiveKit&apos;s real-time infrastructure) to conduct this
                  interview. Audio is streamed and not stored by this platform — only the text transcript is kept. If
                  you&apos;d rather not, typing your answers is always available and is evaluated identically.
                </p>
                <Button
                  size="lg"
                  loading={consentBusy}
                  onClick={async () => {
                    await acceptVoiceConsent();
                    try {
                      await lk.connect();
                    } catch {
                      // Never a dead end: fall back to the turn-based interview every candidate
                      // gets today.
                      setError("Couldn't start the live interview — switching to the standard voice interview.");
                      await lk.disconnect();
                    }
                  }}
                >
                  <Mic className="h-4 w-4" /> Agree &amp; start interview
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
                <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
                  {(lk.phase === "connecting" || lk.phase === "waiting_agent") && (
                    <p className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Connecting you to{" "}
                      {lk.personaName || "your interviewer"}…
                    </p>
                  )}
                  {/* The pipeline has no speaking/thinking granularity — the worker owns
                      turn-taking — so the whole conversation is one "live" state. */}
                  {lk.phase === "live" && (
                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      In conversation — just talk, you can cut in any time
                    </p>
                  )}
                  {lk.error && <p className="text-sm font-medium text-red-600">{lk.error}</p>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await lk.disconnect();
                    switchToTyping();
                  }}
                  className="rounded py-1 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                >
                  <Keyboard className="mr-1 inline h-3 w-3" /> Switch to typing
                </button>
              </div>
            )
          ) : voiceMode ? (
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
                      {(canInterrupt || bargeIn) && (
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
                  {/* Parity with the spoken "I don't know". Without it, a typing candidate's only
                      way to decline is to write "I don't know" into the answer box and have it
                      scored as an answer — which is exactly the behaviour this whole change
                      exists to remove. Recorded as a decline, not as a zero. */}
                  {!state.currentIsWarmup && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => submitAct({ act: "decline", text: "I don't know.", inputMode: "text" })}
                      className="rounded py-1 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-50"
                    >
                      I don&apos;t know this one — skip it
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

      {/* The way out.
          Deliberately always visible rather than hidden behind a menu, and deliberately plain:
          a candidate who wants to leave should not have to hunt, and should not be made to feel
          they are doing something irregular. It is the same exit the spoken "I want to stop"
          reaches — this one just needs no particular words, which matters most for exactly the
          candidates least likely to find them. */}
      {!confirmingExit ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setConfirmingExit(true)}
            className="rounded py-1 text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
          >
            End interview
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
          <p className="text-sm font-medium text-slate-900">End this interview now?</p>
          {/* Says what actually happens, without pressure in either direction. No "you won't be
              able to return" scare copy and no attempt to talk them out of it — but no false
              comfort either: it does end here, and that is stated plainly. */}
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Your answers so far are recorded and go to the hiring team with your application, and a person will review
            them. This interview won&apos;t continue after you end it.
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmingExit(false)}>
              Keep going
            </Button>
            <Button size="sm" onClick={endInterview}>
              End interview
            </Button>
          </div>
        </div>
      )}
    </div>
    );
  }

  return <InterviewShell stage={live ? "live" : "setup"}>{body}</InterviewShell>;
}
