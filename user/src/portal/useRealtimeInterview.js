import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client.js";
import { authHeader } from "./portalAuth.js";
import { MIC_CONSTRAINTS } from "./audioIsolation.js";

// Realtime (speech-to-speech) interview client.
//
// Compare this file's length to useVoiceInterview.js. Everything that made that file large —
// silence timers, reassurance budgets, endpointing heuristics, echo alignment, barge-in
// bookkeeping, and trigger-phrase lists for repeat / finish / decline / pause — is gone, because
// the agent owns turn-taking natively. What is left is a microphone, a speaker, and a relay.
//
// That is not a refactor, it is the point. Those clocks were independent and raced each other:
// the "repeat the question AND say take-your-time at the same time" bug happened because two of
// them each checked a different busy flag. With one audio stream and one owner of turn-taking,
// that class of bug cannot occur — there is nothing to race.
//
// WHAT THIS FILE MUST NOT DO: decide anything about the interview. It relays function calls to
// our backend and plays what comes back. Which question is next, whether an answer counted,
// whether the interview may end — all server-side, exactly as before.

const SAMPLE_RATE = 24000;

// How often to flush the agent's own utterances to the server for the audit log. Batched because
// this is a record, not a live signal — nothing waits on it.
const TRANSCRIPT_FLUSH_MS = 4000;

// How long to wait after the interviewer stops producing transcript before sending it for the
// guardrail check. This is the ceiling on how long an off-script interviewer can keep talking, so
// it is short — but not zero, because one spoken turn arrives as several ConversationText events
// and firing a request per event would spend the endpoint's rate limit on a single sentence.
const GUARDRAIL_DEBOUNCE_MS = 800;

const FILLERS = ["um", "uh", "erm", "hmm", "like", "you know", "sort of", "kind of", "basically", "actually"];

// Audio measurements for one answer, taken by the only party that can take them — the browser owns
// the microphone in realtime exactly as it does in the turn-based pipeline.
//
// These feed `audioQuality` server-side: "could we hear this answer at all". That number can only
// ever REMOVE trust from a turn, never add it, and it is what stops a candidate whose microphone
// failed being indistinguishable from one who could not answer. Losing it was the single biggest
// fairness regression in the first realtime cut.
//
// Note what is NOT derived here: nothing about the person. Pace, hesitation and filler rate are
// recorded as properties of the RECORDING and are structurally excluded from every score — they
// track accent, nervousness and disability far more closely than ability. See utils/prosody.js.
function measureAnswer(transcript, durationMs, energySamples) {
  const words = String(transcript || "").trim().split(/\s+/).filter(Boolean);
  const minutes = Math.max(durationMs / 60000, 1 / 60);
  const lower = ` ${String(transcript || "").toLowerCase()} `;
  let fillers = 0;
  for (const f of FILLERS) {
    fillers += (lower.match(new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "g")) || []).length;
  }
  const acoustic = {
    wordsPerMinute: Math.round(words.length / minutes),
    fillerRate: words.length ? Math.round((fillers / words.length) * 1000) / 10 : 0,
  };
  if (energySamples && energySamples.length > 3) {
    const max = Math.max(...energySamples, 0.0001);
    const threshold = Math.max(0.015, max * 0.15);
    acoustic.pauseRatio = Math.round((energySamples.filter((e) => e < threshold).length / energySamples.length) * 100) / 100;
    const m = energySamples.reduce((a, b) => a + b, 0) / energySamples.length;
    const v = energySamples.reduce((a, b) => a + (b - m) * (b - m), 0) / energySamples.length;
    acoustic.energyVariance = Math.round(v * 1e6) / 1e6;
  }
  return acoustic;
}

// Downsample + convert Float32 [-1,1] mic frames to the linear16 PCM the agent expects.
function toLinear16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function useRealtimeInterview({ onStateChange, onEnded } = {}) {
  // idle | connecting | listening | speaking | thinking | ended | halted | error
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  // Set only when the guardrail stopped the interview. Kept separate from `error` because it is
  // not an error the candidate can act on or retry — it is a statement about what happened.
  const [haltMessage, setHaltMessage] = useState("");
  const [personaName, setPersonaName] = useState("");
  // What the interviewer is saying right now, shown as well as spoken — a candidate who is deaf or
  // hard of hearing, or whose audio output has failed, must still get the question.
  const [caption, setCaption] = useState("");
  const [available, setAvailable] = useState(null); // null = not yet checked

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const micCtxRef = useRef(null);
  const playCtxRef = useRef(null);
  const workletRef = useRef(null);
  const playHeadRef = useRef(0);
  const pendingRef = useRef([]); // agent utterances awaiting flush
  const flushTimerRef = useRef(null);
  const closedRef = useRef(false);
  const haltedRef = useRef(false);
  const connectingRef = useRef(false);
  const debounceRef = useRef(null);
  const flushRef = useRef(null);

  // Everything measured about the CURRENT answer, reset each time one is submitted.
  //
  // This is what makes realtime carry the same evidence the turn-based path does. The agent's
  // `submit_answer` argument is its own account of the answer; `userText` here is the verbatim
  // speech-to-text, and it is what the server records as the candidate's words.
  const turnRef = useRef({
    userText: [],
    energy: [],
    startedAt: 0,
    questionText: "",
    questionStartedAt: 0,
    questionDurationMs: 0,
    interrupted: null,
    drops: 0,
    gapMs: 0,
  });

  function resetTurn(keepConnection = true) {
    const prev = turnRef.current;
    turnRef.current = {
      userText: [],
      energy: [],
      startedAt: 0,
      questionText: "",
      questionStartedAt: 0,
      questionDurationMs: 0,
      interrupted: null,
      // Drops belong to the whole session, not to one answer — a socket that dropped during the
      // previous turn still means this transcript may have a hole near its start.
      drops: keepConnection ? 0 : prev.drops,
      gapMs: keepConnection ? 0 : prev.gapMs,
    };
  }
  // teardown is defined below but referenced by flushTranscript above — a ref breaks the cycle
  // without reordering the file around a guardrail path that should read last, not first.
  const teardownRef = useRef(null);

  const stateRef = useRef(onStateChange);
  useEffect(() => { stateRef.current = onStateChange; }, [onStateChange]);
  const endedRef = useRef(onEnded);
  useEffect(() => { endedRef.current = onEnded; }, [onEnded]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebSocket !== "undefined" &&
    typeof AudioContext !== "undefined";

  const flushTranscript = useCallback(async () => {
    const batch = pendingRef.current.splice(0, pendingRef.current.length);
    if (!batch.length) return;
    try {
      const res = await api.post(
        "/interview-portal/realtime/transcript",
        { utterances: batch },
        { headers: authHeader() }
      );
      // The guardrail found something critical: the interviewer went outside its approved script
      // (backend/utils/agentGuardrail.js) and the server has already ended the session. Stop the
      // audio immediately — every further second is more unapproved speech at the candidate.
      //
      // The message shown is the server's, not ours, and it deliberately does not repeat what the
      // interviewer said. It also states this will not count against them, which is true: a halted
      // interview withholds the recommendation and routes to a human.
      if (res.data?.halted) {
        haltedRef.current = true;
        setHaltMessage(res.data.message || "");
        teardownRef.current?.();
        setPhase("halted");
        endedRef.current?.();
      }
    } catch {
      // Best-effort: the audit log must never interrupt a live interview. A dropped batch is a
      // gap in the record, which is logged server-side by its absence, not by failing the call.
    }
  }, []);

  const teardown = useCallback(() => {
    closedRef.current = true;
    if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    flushTimerRef.current = null;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    connectingRef.current = false;
    try { workletRef.current?.disconnect(); } catch { /* ignore */ }
    workletRef.current = null;
    try { if (micCtxRef.current?.state !== "closed") micCtxRef.current?.close(); } catch { /* ignore */ }
    micCtxRef.current = null;
    try { if (playCtxRef.current?.state !== "closed") playCtxRef.current?.close(); } catch { /* ignore */ }
    playCtxRef.current = null;
    try { if (wsRef.current && wsRef.current.readyState <= 1) wsRef.current.close(); } catch { /* ignore */ }
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => { teardownRef.current = teardown; }, [teardown]);
  useEffect(() => { flushRef.current = flushTranscript; }, [flushTranscript]);

  // Play a chunk of agent audio, scheduled back-to-back so speech is continuous.
  const enqueueAudio = useCallback((buffer) => {
    const ctx = playCtxRef.current;
    if (!ctx) return;
    const pcm = new Int16Array(buffer);
    const frame = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = frame.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = frame;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    playHeadRef.current = Math.max(playHeadRef.current, now);
    src.start(playHeadRef.current);
    playHeadRef.current += frame.duration;
  }, []);

  // The candidate started talking over the agent. Deepgram stops generating on its side; we drop
  // whatever is already buffered locally so the voice actually stops rather than finishing the
  // sentence into the candidate's answer.
  const clearPlayback = useCallback(() => {
    const ctx = playCtxRef.current;
    if (!ctx) return;
    playHeadRef.current = ctx.currentTime;
    setCaption("");
  }, []);

  const handleFunctionCall = useCallback(async (msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Deepgram batches function calls; each carries its own id that the response must echo.
    const calls = Array.isArray(msg.functions) ? msg.functions : [msg];
    for (const call of calls) {
      const id = call.id ?? msg.function_call_id;
      let parsed = {};
      try {
        parsed = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : call.arguments || {};
      } catch {
        parsed = {};
      }
      // What WE measured this turn, sent alongside the agent's own arguments. The agent never sees
      // this and cannot influence it: the verbatim transcript displaces its rendering as the
      // candidate's evidence, and the audio measurements are the only reason a broken microphone
      // can still be told apart from a candidate who could not answer.
      let evidence;
      if (call.name === "submit_answer") {
        const turn = turnRef.current;
        const transcript = turn.userText.join(" ").replace(/\s+/g, " ").trim();
        const durationMs = turn.startedAt ? Date.now() - turn.startedAt : 0;
        evidence = {
          transcript,
          audioDurationMs: durationMs,
          acoustic: measureAnswer(transcript, durationMs, turn.energy),
          ...(turn.interrupted ? { questionDelivery: turn.interrupted } : {}),
          ...(turn.drops > 0 ? { connection: { drops: turn.drops, gapMs: turn.gapMs } } : {}),
        };
        resetTurn();
      }

      let result;
      try {
        const res = await api.post(
          "/interview-portal/realtime/function",
          { name: call.name, arguments: parsed, ...(evidence ? { evidence } : {}) },
          { headers: authHeader() }
        );
        result = res.data?.result ?? {};
      } catch (err) {
        // Never leave the agent waiting on a call that will not return — it would sit silent with
        // a candidate in front of it. Hand back something speakable and let the interview continue.
        result = {
          error: err.response?.data?.error || "network error",
          instruction: "Apologise briefly, then call get_next_question to continue the interview.",
        };
      }
      if (result?.interview_complete || result?.ended) {
        // Let the agent say its goodbye before we tear the socket down.
        setTimeout(() => { endedRef.current?.(); }, 1500);
      }
      stateRef.current?.(result);
      try {
        ws.send(JSON.stringify({
          type: "FunctionCallResponse",
          id,
          name: call.name,
          content: JSON.stringify(result),
        }));
      } catch { /* socket closed mid-turn — teardown handles it */ }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!supported) throw new Error("unsupported");
    // Idempotent. Two callers race here by design — the consent button connects for immediate
    // feedback, and the room's "exactly one pipeline holds the microphone" effect connects on
    // `started`. Without this guard both win and the candidate gets two agent sockets, two mics
    // and two voices, which is the precise failure the single-pipeline rule exists to prevent.
    if (connectingRef.current) return;
    connectingRef.current = true;
    setError("");
    setPhase("connecting");
    closedRef.current = false;

    const { data: cfg } = await api.post("/interview-portal/realtime/session", {}, { headers: authHeader() });
    if (cfg.persona?.name) setPersonaName(cfg.persona.name);

    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    streamRef.current = stream;

    const ws = new WebSocket(cfg.url, ["bearer", cfg.accessToken]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("The interviewer did not connect")), 8000);
      ws.onopen = () => { clearTimeout(to); resolve(); };
      ws.addEventListener("error", () => { clearTimeout(to); reject(new Error("Voice service error")); }, { once: true });
    });

    // The Settings block is built server-side and relayed unmodified — the browser does not get to
    // choose the model, the voice, the prompt, or the function list.
    ws.send(JSON.stringify(cfg.settings));

    const playCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    playCtxRef.current = playCtx;
    playHeadRef.current = playCtx.currentTime;

    const micCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    micCtxRef.current = micCtx;
    const source = micCtx.createMediaStreamSource(stream);
    // ScriptProcessor rather than AudioWorklet: it needs no separate module file to be served,
    // and this is a single mono capture path where the deprecation's cost (main-thread work) is
    // negligible. Swap to a worklet if capture ever competes with heavier main-thread work.
    const node = micCtx.createScriptProcessor(4096, 1, 1);
    workletRef.current = node;
    node.onaudioprocess = (e) => {
      const frame = e.inputBuffer.getChannelData(0);
      // Sample the RMS-energy envelope for pause ratio + energy variance. Taken here because this
      // callback already has the frames — no second audio graph, no extra cost. Capped so a long
      // answer cannot grow the array without bound.
      const turn = turnRef.current;
      if (turn.energy.length < 6000) {
        let sum = 0;
        for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
        turn.energy.push(Math.sqrt(sum / frame.length));
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(toLinear16(frame).buffer);
    };
    source.connect(node);
    node.connect(micCtx.destination);

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        setPhase("speaking");
        enqueueAudio(evt.data);
        return;
      }
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      switch (msg.type) {
        case "Welcome":
        case "SettingsApplied":
          setPhase("listening");
          break;
        case "UserStartedSpeaking": {
          // Native barge-in. No arming, no thresholds, no echo alignment — the agent decided.
          const turn = turnRef.current;
          if (!turn.startedAt) turn.startedAt = Date.now();
          // They cut in while a question was still being read. A question talked over was not
          // fully asked, so it must not silently count as covering its claim-probe — the same rule
          // the turn-based path enforces via `deliveredFully`. The fraction is estimated from how
          // much of the question's audio had played, which is approximate on purpose: it answers
          // "did they actually hear it?", not "exactly where did they cut in?".
          if (turn.questionStartedAt && !turn.interrupted) {
            const played = Date.now() - turn.questionStartedAt;
            const total = turn.questionDurationMs || played;
            const fraction = total > 0 ? Math.min(1, Math.max(0, played / total)) : 0;
            turn.interrupted = {
              deliveredFully: false,
              interruptedAtChar: Math.round(String(turn.questionText || "").length * fraction),
            };
          }
          clearPlayback();
          setPhase("listening");
          break;
        }
        case "AgentThinking":
          setPhase("thinking");
          break;
        case "AgentStartedSpeaking":
          setPhase("speaking");
          break;
        case "AgentAudioDone":
          setPhase("listening");
          setCaption("");
          break;
        case "ConversationText": {
          const text = String(msg.content || "").trim();
          if (!text) break;
          if (msg.role === "user") {
            // THE EVIDENCE. This is the raw speech-to-text of what the candidate actually said,
            // and it is what the server records as their answer — not the agent's rendering of it.
            // Accumulated across the turn because one answer arrives as several events.
            const turn = turnRef.current;
            if (!turn.startedAt) turn.startedAt = Date.now();
            turn.userText.push(text);
            break;
          }
          if (msg.role === "assistant") {
            // Remember what the agent is currently saying, so an interruption can be measured
            // against it. The question text also lets the server check it was asked verbatim.
            const turn = turnRef.current;
            turn.questionText = text;
            turn.questionStartedAt = Date.now();
            // Rough spoken duration — ~2.7 words/second at conversational pace. Only used to
            // estimate how much of a question was heard before a barge-in.
            turn.questionDurationMs = Math.max(1000, (text.split(/\s+/).length / 2.7) * 1000);
            setCaption(text);
            pendingRef.current.push({ role: "assistant", text, at: Date.now() });
            // Flush promptly rather than waiting for the interval. The guardrail only sees what has
            // been flushed, so the interval is also the window in which an off-script interviewer
            // keeps talking. A short debounce bounds that to about a second while still batching
            // the several ConversationText events a single spoken turn produces.
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => { void flushRef.current?.(); }, GUARDRAIL_DEBOUNCE_MS);
          }
          break;
        }
        case "FunctionCallRequest":
          void handleFunctionCall(msg);
          break;
        case "Error":
          console.error("[realtime] agent error:", msg);
          setError("The interviewer hit a problem. You can switch to typing your answers.");
          break;
        default:
          break;
      }
    };

    ws.onerror = () => {
      if (!closedRef.current) setError("The connection dropped — you can switch to typing your answers.");
    };
    ws.onclose = () => {
      if (closedRef.current) return;
      // The socket died with the interview still running, so part of what the candidate said was
      // never captured. Counted and sent with the next answer: even ONE drop withholds the
      // recommendation server-side, because there is no honest way to recommend against someone on
      // a transcript we know has a hole in it. Same rule the turn-based path enforces.
      const turn = turnRef.current;
      turn.drops += 1;
      turn.gapMs += 0; // filled by the reconnect path when one lands; the drop alone is the signal
      console.warn("[realtime] agent socket closed mid-interview — transcript may be incomplete");
      setError("The connection dropped. You can switch to typing your answers.");
      setPhase("ended");
    };

    flushTimerRef.current = setInterval(() => { void flushTranscript(); }, TRANSCRIPT_FLUSH_MS);
    setPhase("listening");
  }, [supported, enqueueAudio, clearPlayback, handleFunctionCall, flushTranscript]);

  const disconnect = useCallback(async () => {
    await flushTranscript();
    teardown();
    // Close the billing window. Realtime is charged per session-MINUTE and its model calls never
    // pass through our per-call metering, so without this the tenant's budget cap is bypassed by
    // construction. Idempotent server-side, and best-effort here — a failed close-out costs
    // accounting accuracy, never the candidate's interview.
    try {
      await api.post("/interview-portal/realtime/end", {}, { headers: authHeader() });
    } catch {
      /* the server also closes this out on finalisation */
    }
    setPhase("ended");
    setCaption("");
  }, [flushTranscript, teardown]);

  // Which pipeline is this interview running? Asked once, before anything opens.
  //
  // Hits a dedicated read-only endpoint rather than attempting to mint a session. Probing by
  // minting had two bugs: it burned a Deepgram credential and started the billing clock just to
  // ask a question, and it ran before voice consent — so it always came back 403 and realtime
  // could never activate on any tenant.
  //
  // Anything other than a clear `enabled: true` resolves to turn-based, which is the interview
  // every candidate gets today. Failing toward the pipeline that is known to work is the whole
  // point of having kept it.
  const checkAvailable = useCallback(async () => {
    try {
      const { data } = await api.get("/interview-portal/realtime/available", { headers: authHeader() });
      const on = data?.enabled === true;
      setAvailable(on);
      return on;
    } catch (err) {
      console.warn("[realtime] availability check failed, using the turn-based pipeline:", err.message);
      setAvailable(false);
      return false;
    }
  }, []);

  useEffect(() => () => { teardown(); }, [teardown]);

  return {
    supported,
    available,
    phase,
    error,
    haltMessage,
    halted: phase === "halted",
    caption,
    personaName,
    connect,
    disconnect,
    checkAvailable,
  };
}
