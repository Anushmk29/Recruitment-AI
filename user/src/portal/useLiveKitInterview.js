import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import api from "../api/client.js";
import { authHeader } from "./portalAuth.js";

// LiveKit realtime interview client (LIVEKIT-REALTIME-PLAN.md LK-4).
//
// Compare this file to useVoiceInterview.js: the turn-based client owns turn-taking, audio
// plumbing, and intent phrases; this one owns none of it. The worker (agent-worker/) holds the
// keys, captures the evidence, and feeds the guardrail server-side — what is left here is a
// WebRTC join, a speaker, live captions, and two endpoints. (A middle step, the Deepgram-agent
// client that relayed audio and transcripts through the browser, was retired in favour of this.)
//
// WHAT THIS FILE MUST NOT DO: decide anything about the interview, or hold anything sensitive.
// The session endpoint returns a join-only room token — no model keys, no Settings block, no
// prompt — and everything that advances the interview happens between the worker and the engine.
//
// Surface: { available, phase, error, haltMessage, halted, caption, personaName, connect,
// disconnect, checkAvailable }.

// If the interviewer has not joined this long after WE joined, something is wrong on our side
// (worker down, dispatch failed). Tear down and mark the pipeline unavailable — the room's mode
// flags then fall back to the next pipeline automatically. A candidate never sits in an empty
// room listening to silence.
const AGENT_JOIN_TIMEOUT_MS = 10_000;

export function useLiveKitInterview({ onEnded } = {}) {
  const [available, setAvailable] = useState(null);
  // idle → connecting → waiting_agent → live → ended | failed
  const [phase, setPhase] = useState("idle");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [personaName, setPersonaName] = useState("");

  const roomRef = useRef(null);
  const connectingRef = useRef(false);
  const watchdogRef = useRef(null);
  const wasLiveRef = useRef(false);
  const audioElsRef = useRef([]);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const checkAvailable = useCallback(async () => {
    try {
      const res = await api.get("/interview-portal/livekit/available", { headers: authHeader() });
      const enabled = Boolean(res.data?.enabled);
      setAvailable(enabled);
      return enabled;
    } catch {
      // 404/failure just means "not this pipeline" — the interview every candidate gets today is
      // unaffected.
      setAvailable(false);
      return false;
    }
  }, []);

  const teardownMedia = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    for (const el of audioElsRef.current) {
      try {
        el.remove();
      } catch {
        /* already gone */
      }
    }
    audioElsRef.current = [];
  }, []);

  const disconnect = useCallback(async () => {
    teardownMedia();
    const room = roomRef.current;
    roomRef.current = null;
    connectingRef.current = false;
    if (room) {
      try {
        await room.disconnect();
      } catch {
        /* closing anyway */
      }
    }
    // Close the billing window. Idempotent server-side; in production the room_finished webhook
    // is the backstop for the cases where this request never lands.
    try {
      await api.post("/interview-portal/livekit/end", {}, { headers: authHeader() });
    } catch {
      /* webhook backstop */
    }
    setPhase((p) => (p === "failed" ? p : "ended"));
  }, [teardownMedia]);

  const connect = useCallback(async () => {
    // Idempotent — the consent button and the room's enforcement effect race this deliberately,
    // same lesson as the Deepgram pipeline's connectingRef.
    if (connectingRef.current || roomRef.current) return;
    connectingRef.current = true;
    setError("");
    setPhase("connecting");

    try {
      const res = await api.post("/interview-portal/livekit/session", {}, { headers: authHeader() });
      const { url, token, persona } = res.data || {};
      if (persona?.name) setPersonaName(persona.name);

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => {
        // The interviewer arrived. From here on, everything is just talking.
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        wasLiveRef.current = true;
        setPhase("live");
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.style.display = "none";
          document.body.appendChild(el);
          audioElsRef.current.push(el);
        }
      });

      // Live captions: the worker publishes both sides' transcription. Only the interviewer's
      // lines are shown — watching your own words appear turns a conversation into a dictation
      // exercise (same rule as every other pipeline).
      room.registerTextStreamHandler("lk.transcription", async (reader, participantInfo) => {
        try {
          const text = (await reader.readAll())?.trim();
          const identity = participantInfo?.identity || "";
          if (text && identity.startsWith("agent-")) setCaption(text);
        } catch {
          /* caption loss is cosmetic */
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        // The worker deletes the room when the interview closes (complete, withdrawn, or
        // halted); a mid-interview drop also lands here after reconnect attempts run out. The
        // room refetches the interview state either way — the SERVER knows which one happened,
        // and this client never guesses.
        roomRef.current = null;
        teardownMedia();
        if (wasLiveRef.current) {
          setPhase("ended");
          onEndedRef.current?.();
        }
      });

      await room.connect(url, token);
      try {
        await room.startAudio(); // called within the consent click's gesture chain (iOS Safari)
      } catch {
        /* playback will start on the next gesture */
      }
      // DTX (discontinuous transmission) is ON by default for mono tracks: it stops sending packets
      // during silence to save bandwidth, and the far end reconstructs the gaps as synthesised
      // comfort noise. On a track whose only consumer is an ASR model that is the wrong trade —
      // what blurs first is the onset of a word after a pause, which is exactly where a candidate
      // resumes an answer. Bandwidth is not the constraint in a one-to-one interview and the
      // transcript is the evidence a score cites, so it is bought back here. RED (redundant
      // encoding) stays ON: it also costs bandwidth, but it buys packet-loss resilience, which
      // makes the transcript better rather than worse.
      await room.localParticipant.setMicrophoneEnabled(true, undefined, { dtx: false, red: true });

      if (room.remoteParticipants && room.remoteParticipants.size > 0) {
        wasLiveRef.current = true;
        setPhase("live");
      } else {
        setPhase("waiting_agent");
        watchdogRef.current = setTimeout(() => {
          // No interviewer. Fault is on our side — fail the PIPELINE, not the candidate:
          // available=false recomputes the room's mode flags and the next pipeline takes over.
          console.error("[livekit] agent did not join in time — falling back");
          setError("Couldn't start the live interview — switching to the standard voice interview.");
          setAvailable(false);
          setPhase("failed");
          void disconnect();
        }, AGENT_JOIN_TIMEOUT_MS);
      }
    } catch (err) {
      roomRef.current = null;
      connectingRef.current = false;
      teardownMedia();
      setAvailable(false); // this pipeline is not happening today; fall back, never dead-end
      setPhase("failed");
      throw err;
    }
    connectingRef.current = false;
  }, [disconnect, teardownMedia]);

  // Tab closed mid-interview: best-effort metering flush that survives page teardown. The
  // room_finished webhook is the authoritative backstop in production.
  useEffect(() => {
    const flush = () => {
      if (!roomRef.current) return;
      try {
        const base = (api.defaults?.baseURL || "").replace(/\/$/, "");
        void fetch(`${base}/interview-portal/livekit/end`, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: "{}",
        });
      } catch {
        /* webhook backstop */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Unmount = leave. Never leave a live room behind a dead component.
  useEffect(() => {
    return () => {
      if (roomRef.current) void disconnect();
    };
  }, [disconnect]);

  return {
    available,
    phase,
    error,
    // The halt decision and message live server-side; after the worker speaks it and closes the
    // room, the refetched interview state carries `halted` and the room shows that screen.
    haltMessage: "",
    halted: false,
    caption,
    personaName,
    connect,
    disconnect,
    checkAvailable,
  };
}
