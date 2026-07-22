import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client.js";
import { authHeader } from "./portalAuth.js";

// Real-time voice pipeline for the AI interview.
//
//  - TTS (spoken questions): POST /interview-portal/voice/speak → MP3 (Deepgram Aura, proxied by
//    our backend so the key stays server-side). Falls back to the browser's SpeechSynthesis if
//    the proxy is unavailable, so a question is always spoken.
//  - STT (spoken answers): stream mic audio to Deepgram's WebSocket using a short-lived token
//    from GET /interview-portal/voice/token. We accumulate the final transcript + confidence and
//    a couple of cheap delivery measurements (words/min, filler rate); richer prosody is added
//    server-side later. Turn-end is hands-free: Deepgram's UtteranceEnd (silence for
//    utterance_end_ms after speech) ends the turn automatically, with a manual "Done" override.
//
// Everything degrades gracefully: if the mic or socket fails, the caller can fall back to typing.

const FILLERS = ["um", "uh", "erm", "hmm", "like", "you know", "sort of", "kind of", "basically", "actually"];

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

// Delivery measurements for a spoken answer: words/min + filler rate from the transcript, plus
// pause ratio + energy variance from the sampled RMS-energy envelope. These are raw inputs; the
// delivery/confidence *scores* are derived server-side (utils/prosody.js) so they can't be faked.
function measureDelivery(transcript, durationMs, energySamples) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const minutes = Math.max(durationMs / 60000, 1 / 60);
  const wordsPerMinute = Math.round(words.length / minutes);
  const lower = ` ${transcript.toLowerCase()} `;
  let fillers = 0;
  for (const f of FILLERS) {
    const re = new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "g");
    fillers += (lower.match(re) || []).length;
  }
  const fillerRate = words.length ? Math.round((fillers / words.length) * 1000) / 10 : 0; // per 100 words

  const acoustic = { wordsPerMinute, fillerRate };
  if (energySamples && energySamples.length > 3) {
    const max = Math.max(...energySamples, 0.0001);
    const silenceThreshold = Math.max(0.015, max * 0.15);
    const silent = energySamples.filter((e) => e < silenceThreshold).length;
    acoustic.pauseRatio = Math.round((silent / energySamples.length) * 100) / 100;
    const m = energySamples.reduce((a, b) => a + b, 0) / energySamples.length;
    const v = energySamples.reduce((a, b) => a + (b - m) * (b - m), 0) / energySamples.length;
    acoustic.energyVariance = Math.round(v * 1e6) / 1e6;
  }
  return acoustic;
}

export function useVoiceInterview({ onAutoEndOfTurn } = {}) {
  const [phase, setPhase] = useState("idle"); // idle | speaking | listening | processing
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  // Latest end-of-turn callback (the caller submits the answer + advances). Kept in a ref so the
  // live WebSocket message handler always calls the current one without reopening the socket.
  const autoEndRef = useRef(onAutoEndOfTurn);
  useEffect(() => { autoEndRef.current = onAutoEndOfTurn; }, [onAutoEndOfTurn]);
  const endedRef = useRef(false); // guards a single auto end-of-turn per answer

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const keepAliveRef = useRef(null);
  const audioCtxRef = useRef(null); // Web Audio graph for prosody sampling
  const samplerRef = useRef(null);
  const sessionRef = useRef(null); // accumulator for the in-progress answer

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebSocket !== "undefined" &&
    typeof MediaRecorder !== "undefined";

  const cleanupAnswer = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
    if (samplerRef.current) clearInterval(samplerRef.current);
    samplerRef.current = null;
    try {
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
    } catch { /* ignore */ }
    audioCtxRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch { /* ignore */ }
    recorderRef.current = null;
    try {
      if (wsRef.current && wsRef.current.readyState <= 1) wsRef.current.close();
    } catch { /* ignore */ }
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  // Speak a question. Resolves when playback finishes (or fails over to browser TTS).
  const speak = useCallback(
    async (text) => {
      if (!text) return;
      setPhase("speaking");
      try {
        const res = await api.post(
          "/interview-portal/voice/speak",
          { text },
          { headers: authHeader(), responseType: "blob" }
        );
        const url = URL.createObjectURL(res.data);
        await new Promise((resolve) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(() => resolve());
        });
        audioRef.current = null;
      } catch {
        await browserSpeak(text);
      } finally {
        setPhase((p) => (p === "speaking" ? "idle" : p));
      }
    },
    []
  );

  function browserSpeak(text) {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  // Begin capturing a spoken answer. Streams mic audio to Deepgram and updates `interim` live.
  const startListening = useCallback(async () => {
    if (!supported) throw new Error("unsupported");
    setError("");
    setInterim("");
    endedRef.current = false;
    stopSpeaking(); // barge-in: cut any question playback the moment the candidate starts

    const { data: cred } = await api.get("/interview-portal/voice/token", { headers: authHeader() });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const p = cred.stt || {};
    const params = new URLSearchParams({
      model: p.model || "nova-3",
      language: p.language || "en",
      interim_results: "true",
      utterance_end_ms: String(p.utteranceEndMs || 2000),
      punctuate: "true",
      smart_format: "true",
    });
    // Browsers can't set WS headers, but Deepgram accepts the short-lived token as a WebSocket
    // subprotocol (Sec-WebSocket-Protocol: "bearer, <token>"). Passing it as an ?access_token=
    // query param is NOT accepted and silently fails the handshake — verified against the live
    // API. The raw DEEPGRAM_API_KEY still never reaches the browser (only this ~60s token does).
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    const ws = new WebSocket(url, ["bearer", cred.accessToken]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const acc = { finalText: "", lastInterim: "", confidence: 0, startedAt: Date.now(), energy: [] };
    sessionRef.current = acc;

    // Sample the RMS-energy envelope ~10x/sec for pause-ratio + energy-variance (prosody).
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const audioCtx = new Ctx();
        audioCtxRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        const frame = new Float32Array(analyser.fftSize);
        samplerRef.current = setInterval(() => {
          if (!analyser.getFloatTimeDomainData) return;
          analyser.getFloatTimeDomainData(frame);
          let sum = 0;
          for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
          acc.energy.push(Math.sqrt(sum / frame.length));
        }, 100);
      }
    } catch { /* prosody is best-effort — never block the interview */ }

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.type === "UtteranceEnd") {
        // Hands-free turn-taking: the candidate has been silent for utterance_end_ms after
        // speaking, so the turn is over — hand off to the caller to submit and advance.
        if ((acc.finalText || "").trim() && !endedRef.current) {
          endedRef.current = true;
          autoEndRef.current?.();
        }
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      const t = alt?.transcript || "";
      if (!t) return;
      if (msg.is_final) {
        acc.finalText = `${acc.finalText} ${t}`.trim();
        acc.lastInterim = "";
        if (alt.confidence) acc.confidence = Math.max(acc.confidence, alt.confidence);
        setInterim(acc.finalText);
      } else {
        acc.lastInterim = t;
        setInterim(`${acc.finalText} ${t}`.trim());
      }
    };
    ws.onerror = () => setError("Voice connection dropped — you can type your answer instead.");

    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("Voice service did not connect")), 6000);
      ws.onopen = () => { clearTimeout(to); resolve(); };
      ws.addEventListener("error", () => { clearTimeout(to); reject(new Error("Voice service error")); }, { once: true });
    });

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    recorder.start(250);
    keepAliveRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 8000);

    setPhase("listening");
  }, [supported, stopSpeaking]);

  // Finish the current answer: flush Deepgram, tear down, and return the transcript + metadata.
  const finishListening = useCallback(async () => {
    const acc = sessionRef.current;
    setPhase("processing");
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch { /* ignore */ }
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      }
    } catch { /* ignore */ }
    // Give Deepgram a beat to emit any trailing final result before we close.
    await new Promise((r) => setTimeout(r, 450));
    cleanupAnswer();

    const transcript = (acc?.finalText || acc?.lastInterim || "").trim();
    const durationMs = acc ? Date.now() - acc.startedAt : 0;
    sessionRef.current = null;
    setPhase("idle");
    setInterim("");
    if (!transcript) return null;
    return {
      transcript,
      durationMs,
      confidence: acc.confidence || undefined,
      acoustic: measureDelivery(transcript, durationMs, acc.energy),
    };
  }, [cleanupAnswer]);

  const cancelListening = useCallback(() => {
    cleanupAnswer();
    sessionRef.current = null;
    setInterim("");
    setPhase("idle");
  }, [cleanupAnswer]);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      stopSpeaking();
      cleanupAnswer();
    };
  }, [stopSpeaking, cleanupAnswer]);

  return { supported, phase, interim, error, speak, stopSpeaking, startListening, finishListening, cancelListening };
}
