import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client.js";
import { authHeader } from "./portalAuth.js";
import { MIC_CONSTRAINTS } from "./audioIsolation.js";
import { classify, detectFinish, normalizeEndpointing } from "./endpointing.js";
import { detectAct, detectConfirmation, normalizeDialogueActs } from "./dialogueActs.js";
import { classifyEcho } from "./echoAlignment.js";

// Real-time voice pipeline for the AI interview.
//
//  - TTS (spoken questions + the interviewer's backchannels): POST /interview-portal/voice/speak
//    → MP3 (proxied by our backend so the key stays server-side). Falls back to the browser's
//    SpeechSynthesis if the proxy is unavailable, so a question is always spoken.
//  - STT (spoken answers): stream mic audio to Deepgram's WebSocket using a short-lived token
//    from GET /interview-portal/voice/token. We accumulate the final transcript + confidence and
//    a couple of cheap delivery measurements (words/min, filler rate); richer prosody is added
//    server-side later.
//  - Turn-taking is hands-free AND conversational: silence no longer ends the turn on a timer.
//    It first buys the candidate reassurance out loud ("take your time — I'm here") and a much
//    longer window; once that patience is spent the interviewer ASKS ("anything you'd like to
//    add?") rather than simply stopping, and only then does silence end the turn. A manual
//    "Done" override is always available.
//    The asking step exists because candidates reported the timer-only ending as being cut off
//    mid-thought — which it was. It costs a few seconds and makes the end of a turn the
//    candidate's decision instead of a countdown's.
//
// What the interviewer may SAY is never decided here. The phrases and the timings arrive from
// the server (backend/utils/backchannel.js — a fixed, human-approved bank); this file owns only
// the real-time detection of when to use them, because that is the only thing the browser knows.
//
// Everything degrades gracefully: if the mic or socket fails, the caller can fall back to typing.

const FILLERS = ["um", "uh", "erm", "hmm", "like", "you know", "sort of", "kind of", "basically", "actually"];

// The final window between "you've gone quiet and I've run out of patience to offer" and actually
// ending the turn is `endingGraceMs`, and the much shorter one after a plainly-finished answer is
// `settledGraceMs`. Both arrive from the server with the streaming credential, like every other
// number here — a tenant's interview conditions are configured in one place, and a timing that
// decides when a candidate gets cut off is not the browser's to invent.

// How much transcribed speech during question playback counts as "the candidate is talking to me"
// rather than a cough or a keyboard click. Scraps of echo are no longer what this defends against
// — echoAlignment.js does that by comparing against what we are actually saying — so this is only
// the noise floor: enough that the interviewer doesn't stop mid-word over a click.
const BARGE_IN_MIN_CHARS = 4;

// How long after the last between-turns word before the next question may be asked. Short — this
// is not the endpointing decision (nothing is being submitted here), only "are they mid-sentence
// right now". Long enough not to cut across "oh, and one more thing", short enough that a cough
// does not stall the interview.
const BETWEEN_TURNS_IDLE_MS = 1500;

// Used only if the server sends no conversational policy (older backend). Reassurance is then
// OFF rather than improvised locally: the approved phrase bank lives server-side and is the only
// source of what the interviewer is allowed to say, so the client never invents a phrase.
function normalizePolicy(c) {
  const reassurances = Array.isArray(c?.reassurances) ? c.reassurances.filter(Boolean) : [];
  const acknowledgements = Array.isArray(c?.acknowledgements) ? c.acknowledgements.filter(Boolean) : [];
  const repeatTriggers = Array.isArray(c?.repeatTriggers) ? c.repeatTriggers.filter(Boolean) : [];
  const repeatPreambles = Array.isArray(c?.repeatPreambles) ? c.repeatPreambles.filter(Boolean) : [];
  const confirmations = Array.isArray(c?.confirmations) ? c.confirmations.filter(Boolean) : [];
  // Spoken before a question that changes the subject. Empty ⇒ off, same rule as everywhere else:
  // an older backend that sends none simply gets the old abrupt behaviour rather than a phrase
  // the client made up.
  const bridges = Array.isArray(c?.bridges) ? c.bridges.filter(Boolean) : [];
  const finishTriggers = Array.isArray(c?.finishTriggers) ? c.finishTriggers.filter(Boolean) : [];
  // Replies to the dialogue acts. Empty ⇒ the act is off, same rule as everywhere else here: the
  // client owns the timing, never the words.
  const declineReplies = Array.isArray(c?.declineReplies) ? c.declineReplies.filter(Boolean) : [];
  const withdrawConfirmations = Array.isArray(c?.withdrawConfirmations) ? c.withdrawConfirmations.filter(Boolean) : [];
  const withdrawCancellations = Array.isArray(c?.withdrawCancellations) ? c.withdrawCancellations.filter(Boolean) : [];
  const pauseReplies = Array.isArray(c?.pauseReplies) ? c.pauseReplies.filter(Boolean) : [];
  const clarifyPreambles = Array.isArray(c?.clarifyPreambles) ? c.clarifyPreambles.filter(Boolean) : [];
  const technicalReplies = Array.isArray(c?.technicalReplies) ? c.technicalReplies.filter(Boolean) : [];
  const num = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);
  return {
    reassurances,
    acknowledgements,
    repeatTriggers,
    repeatPreambles,
    confirmations,
    bridges,
    declineReplies,
    withdrawConfirmations,
    withdrawCancellations,
    pauseReplies,
    clarifyPreambles,
    technicalReplies,
    // Telling our own voice from the candidate's while both are live (portal/echoAlignment.js).
    // An older backend sends nothing here, and the fallback is deliberately the SAFE direction:
    // fullDuplex off means the microphone is paused around our own speech exactly as it was
    // before this existed, rather than left open with no way to reject the echo.
    echo: {
      minNovelRun: Math.max(1, Number(c?.echo?.minNovelRun ?? 3)),
      minEchoRun: Math.max(1, Number(c?.echo?.minEchoRun ?? 2)),
      lookaheadRatio: Math.max(0, Number(c?.echo?.lookaheadRatio ?? 0.15)),
      fullDuplex: c?.echo ? c.echo.fullDuplex !== false : false,
    },
    // The semantic intent tier (backend/utils/conversationIntent.js). Absent ⇒ off, and the
    // interviewer understands exactly what the trigger lists cover, as before.
    intent: {
      semanticEnabled: Boolean(c?.intent?.semanticEnabled),
      minWordsForLookup: Math.max(1, Number(c?.intent?.minWordsForLookup ?? 2)),
      maxMetaWords: Math.max(1, Number(c?.intent?.maxMetaWords ?? 25)),
      maxUtteranceWords: Math.max(1, Number(c?.intent?.maxUtteranceWords ?? 45)),
      timeoutMs: num(c?.intent?.timeoutMs, 1200),
    },
    // What counts as declining / pausing / wanting to stop (portal/dialogueActs.js). Detection is
    // local because it must be instant; the rules and the wording are the server's.
    acts: normalizeDialogueActs(c?.dialogueActs),
    confirmGraceMs: num(c?.confirmGraceMs, 5000),
    // How long to keep listening after the provider reports silence, decided from the SHAPE of
    // what was just said rather than from a fixed timer. See endpointing.js.
    endpointing: normalizeEndpointing(c?.endpointing),
    // No triggers from the server ⇒ explicit-finish detection is off, exactly like repeat: what
    // counts as "I'm done" is server-owned and the client never invents it.
    finishTriggers,
    finishMinAnswerWords: Math.max(0, Number(c?.finishMinAnswerWords ?? 12)),
    finishMaxTrailingWords: Math.max(0, Number(c?.finishMaxTrailingWords ?? 2)),
    maxReassurancesPerTurn: reassurances.length ? Math.max(0, Number(c?.maxReassurancesPerTurn ?? 2)) : 0,
    postReassuranceGraceMs: num(c?.postReassuranceGraceMs, 9000),
    initialSilenceMs: num(c?.initialSilenceMs, 6000),
    // How the end of a turn is handled once the interviewer is actually confident it IS the end.
    // See the long note in backend/utils/backchannel.clientPolicy — the short version is that the
    // old code ran the full reassure → check-in → countdown ladder after every answer, including
    // the ones that had plainly finished, and that tail is the single most machine-like thing in
    // the pipeline. The defaults below match the server's.
    settledMinWords: Math.max(0, Number(c?.settledMinWords ?? 12)),
    settledGraceMs: num(c?.settledGraceMs, 600),
    endingGraceMs: num(c?.endingGraceMs, 4000),
    // No triggers from the server ⇒ repeat-on-request is off. What counts as "please repeat" is
    // server-owned, exactly like the phrase bank; the client never invents the rule.
    maxRepeatsPerQuestion: repeatTriggers.length ? Math.max(0, Number(c?.maxRepeatsPerQuestion ?? 3)) : 0,
    repeatMaxCarryWords: Math.max(0, Number(c?.repeatMaxCarryWords ?? 6)),
  };
}

// Mirror of backend/utils/repeatIntent.js — word-sequence matching, not substrings, so "repeat
// that" doesn't fire on "we had to repeat that migration". The TRIGGERS themselves come from the
// server; only the matching runs here, because detection has to be instant.
function detectRepeat(transcript, triggers) {
  let text = String(transcript || "");
  let matched = null;
  // Longest trigger first, matching the server: each match is removed before the next is tried, so
  // taking a short phrase first would leave a fragment of the request in the candidate's answer.
  for (const trigger of [...triggers].sort((a, b) => String(b).length - String(a).length)) {
    const words = String(trigger).toLowerCase().match(/[a-z0-9']+/g) || [];
    if (!words.length) continue;
    const re = new RegExp(`\\b${words.map((w) => w.replace(/'/g, "'?")).join("[^a-z0-9]+")}\\b[.,;:!?…]*`, "gi");
    const next = text.replace(re, " ");
    if (next !== text) {
      if (!matched || trigger.length > matched.length) matched = trigger;
      text = next;
    }
  }
  const remainder = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return {
    matched: Boolean(matched),
    remainder,
    remainderWords: (remainder.match(/[A-Za-z0-9']+/g) || []).length,
  };
}

const NO_POLICY = normalizePolicy(null);

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

// Collapse the per-label word tally into the two numbers the server needs: how many distinct
// speakers were heard, and how many words did NOT belong to the dominant one. Deliberately not a
// verdict — "is this a second person" is a judgement, and judgements are made server-side where a
// candidate cannot influence them.
function summarizeSpeakers(speakerWords) {
  const entries = Object.entries(speakerWords || {});
  if (!entries.length) return undefined;
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const dominant = entries.reduce((a, b) => (a[1] >= b[1] ? a : b));
  return { distinctSpeakers: entries.length, secondaryWords: total - dominant[1] };
}

export function useVoiceInterview({ onAutoEndOfTurn, onDialogueAct } = {}) {
  const [phase, setPhase] = useState("idle"); // idle | speaking | listening | processing
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [endingSoon, setEndingSoon] = useState(false); // out of reassurance, about to auto-submit
  // When the turn will actually end, as an epoch ms, or 0 when nothing is pending. Surfaced so the
  // room can show a real countdown instead of the words "Wrapping up your answer…".
  //
  // A countdown the candidate cannot see is the specific complaint behind "it cut me off": the
  // turn ended on a timer nobody mentioned, while they were drawing breath for the rest of it.
  // Showing it costs nothing and turns an ambush into a deadline they can act on — and there is
  // now something to act WITH (see `keepListening`).
  const [endsAt, setEndsAt] = useState(0);
  // The non-evaluative phrase the interviewer is saying right now, for the UI to show. Never a
  // question and never part of the transcript — see backend/utils/backchannel.js.
  const [backchannel, setBackchannel] = useState("");
  // The interviewer's name for this session, from the tenant's approved persona (or the
  // deployment default). Arrives with the streaming credential; blank until the mic first opens.
  const [personaName, setPersonaName] = useState("");
  // Can the candidate talk over the interviewer on this device? Server-decided (the echo gate),
  // not measured here — and false until the first credential arrives, because promising someone
  // they can interrupt before we know is worse than saying nothing.
  const [canInterrupt, setCanInterrupt] = useState(false);

  // Latest end-of-turn callback (the caller submits the answer + advances). Kept in a ref so the
  // live WebSocket message handler always calls the current one without reopening the socket.
  const autoEndRef = useRef(onAutoEndOfTurn);
  useEffect(() => { autoEndRef.current = onAutoEndOfTurn; }, [onAutoEndOfTurn]);
  // Called when the candidate said something ABOUT the interview rather than into it. The room
  // owns what happens next (it holds the API client); this hook only detects and responds aloud.
  const actRef = useRef(onDialogueAct);
  useEffect(() => { actRef.current = onDialogueAct; }, [onDialogueAct]);
  const endedRef = useRef(false); // guards a single auto end-of-turn per answer
  const graceTimerRef = useRef(null); // pending silence timer (reassure, or really end the turn)

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const keepAliveRef = useRef(null);
  const audioCtxRef = useRef(null); // Web Audio graph for prosody sampling
  const samplerRef = useRef(null);
  const sessionRef = useRef(null); // accumulator for the in-progress answer

  const policyRef = useRef(NO_POLICY);
  const reassureRef = useRef(0); // reassurances spent on THIS turn
  // "Anything you'd like to add?" is offered at most ONCE per turn. Asking again every time the
  // candidate pauses would stop reading as attentive and start reading as nagging — and a turn
  // that can never end is worse than one that ends slightly early.
  const confirmedRef = useRef(false);
  const bcEventsRef = useRef([]); // backchannels played during this turn, reported on submit
  const turnCounterRef = useRef(0); // rotates phrasing across questions so it isn't robotic
  const bcCacheRef = useRef(new Map()); // phrase -> Promise<objectURL>, one synthesis per session
  const bcBusyRef = useRef(false); // one interviewer utterance at a time, never two overlapping
  const handleSilenceRef = useRef(null); // breaks the armSilence <-> handleSilence cycle
  const questionRef = useRef(""); // the question currently being answered, for verbatim repeats
  // Its recruiter-approved plain-language rewording, when the approved set carried one. Read by
  // the clarify path only; empty means this question has none and clarify degrades to a repeat.
  const restatementRef = useRef("");
  const questionAudioRef = useRef(null); // its audio URL, kept so a repeat replays the SAME bytes
  // How long the server expects the current utterance to take. Used only while the streamed audio
  // element does not yet know its own duration — see spokenRatio.
  const spokenEstimateRef = useRef(0);
  const repeatsRef = useRef(0); // repeats of the current question — recorded, never scored
  const repeatBusyRef = useRef(false);
  const repeatQuestionRef = useRef(null);
  // Barge-in: armed while a question is playing. It used to ALSO require a device where the
  // pre-check measured that the mic could not hear the speakers — which meant everybody without
  // headphones got an interviewer they could not interrupt. The echo is now rejected by comparing
  // what we hear against what we are saying (portal/echoAlignment.js), so the hardware no longer
  // decides whether a candidate is allowed to interrupt.
  const bargeInArmedRef = useRef(false);
  const onBargeInRef = useRef(null);
  // What the interviewer is saying RIGHT NOW, and nothing when it is silent. This is the reference
  // signal the echo gate strikes transcripts against, so it has to be set before playback starts
  // and cleared the instant it ends — a stale value here would explain away the candidate's real
  // words as echo of a sentence that finished ten seconds ago.
  const speakingRef = useRef({ text: "", audio: null });
  // Resolver for the playback currently being awaited, so cutting it short (barge-in) can hand
  // control back to whoever was waiting. See stopSpeaking.
  const playbackResolveRef = useRef(null);
  // Withdrawal, mid-flight: the candidate has asked to stop and has been asked to confirm. Holds
  // their original words until a reply arrives. Cleared on confirm, decline, or timeout — and the
  // timeout resumes the interview, because silence here is never read as "yes, end it".
  const withdrawRef = useRef(null);
  const pausedUntilRef = useRef(0); // "give me a second" — a longer window, granted once
  // How completely the current question was actually spoken. An interrupted question was not
  // fully asked, and the server must not count it as having covered its claim-probe.
  const deliveryRef = useRef({ deliveredFully: true, interruptedAtChar: null });
  // ---- Socket lifecycle ---------------------------------------------------
  //
  // A dropped transcription socket used to be completely invisible. There was no `onclose`
  // handler at all: the recorder kept running, every audio chunk was silently dropped by the
  // `readyState === OPEN` guard on send, and the pulsing "Listening" indicator kept running over
  // a dead pipe. The candidate spoke for another ninety seconds, pressed Done, and the truncated
  // transcript was submitted and SCORED AS THEIR COMPLETE ANSWER. Nobody found out — not the
  // candidate, not the recruiter, not the report. That is a wrong score with no trace, which is
  // the one failure this product's whole audit story exists to prevent.
  //
  // `deliberate` distinguishes our own close (finishing a turn, tearing down) from the pipe
  // dying underneath us; without it every normal end-of-turn would look like a disconnection.
  const deliberateCloseRef = useRef(false);
  const reconnectingRef = useRef(false);
  // Reported to the caller with the transcript. A recovered drop still means audio was lost, so
  // it travels with the answer and is recorded on the turn — "we reconnected" is not the same
  // claim as "we heard everything".
  const [connection, setConnection] = useState("idle"); // idle | live | reconnecting | lost
  // What the candidate said BETWEEN turns — after their answer was taken and before the next
  // question was asked. This window used to be deaf: the microphone was torn down with the turn
  // and rebuilt for the next one, so "oh — and one more thing", the most human moment in an
  // interview, went into nothing at all.
  //
  // It is deliberately not appended to any answer. It belongs to the answer they just gave, not
  // to the question they are about to be asked, and filing it under the wrong question would be a
  // worse failure than losing it. It is used to HOLD the next question while they are still
  // talking, and recorded with the following answer as a condition of the interview.
  const betweenTurnsRef = useRef({ text: "", at: 0 });
  const [speakingBetweenTurns, setSpeakingBetweenTurns] = useState(false);
  const betweenTurnsIdleRef = useRef(null);
  // Set up once the session exists; called at the start of every turn.
  const startSamplerRef = useRef(null);
  // Held in a ref so the unmount cleanup can call the CURRENT teardown without listing it as a
  // dependency — an effect that re-ran on every teardown identity change would close the
  // microphone mid-interview.
  const teardownSessionRef = useRef(null);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebSocket !== "undefined" &&
    typeof MediaRecorder !== "undefined";

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Cutting playback short has to RESOLVE the promise that was waiting on it. `pause()` fires
    // neither "ended" nor "error", so without this the awaiting caller waits forever — and on the
    // barge-in path that caller is askAndListen, which never gets to hand the floor back. The turn
    // would look alive (the mic is open, the candidate is talking) while the interviewer had
    // silently stopped listening for the end of it. Rare when barge-in needed measured-isolated
    // hardware; universal now that every candidate can interrupt.
    if (playbackResolveRef.current) {
      const resolve = playbackResolveRef.current;
      playbackResolveRef.current = null;
      resolve();
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    speakingRef.current = { text: "", audio: null };
    setBackchannel("");
  }, []);

  // End the TURN. The microphone, the socket and the recorder survive.
  //
  // This used to tear the whole pipeline down after every answer, which is why the candidate was
  // deaf for the ten-odd seconds while the next question was prepared and spoken, and why every
  // question paid for a token grant, a getUserMedia call and a WebSocket handshake it did not
  // need. What genuinely belongs to one answer is the accumulator, its energy envelope, and the
  // timers watching for the end of it — and that is all this clears now.
  const cleanupAnswer = useCallback(() => {
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = null;
    // An unconfirmed withdrawal dies with the turn. It must never survive into the next question
    // and be confirmed by a "yes" that was answering something else entirely.
    if (withdrawRef.current?.timer) clearTimeout(withdrawRef.current.timer);
    withdrawRef.current = null;
    pausedUntilRef.current = 0;
    setEndingSoon(false);
    setEndsAt(0);
    // A reassurance may still be playing if the candidate tapped "Done" over it.
    stopSpeaking();
    if (samplerRef.current) clearInterval(samplerRef.current);
    samplerRef.current = null;
    try {
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
    } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, [stopSpeaking]);

  // End the SESSION. Everything goes: the socket, the recorder, the microphone itself.
  //
  // Called when the interview is over, when the candidate switches to typing, and on unmount —
  // never between two questions. Note the order: `deliberateCloseRef` FIRST, or the onclose
  // handler reads our own teardown as the connection dying and starts reconnecting a session
  // that has deliberately ended.
  const teardownSession = useCallback(() => {
    deliberateCloseRef.current = true;
    reconnectingRef.current = false;
    cleanupAnswer();
    sessionRef.current = null;
    betweenTurnsRef.current = { text: "", at: 0 };
    setSpeakingBetweenTurns(false);
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
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
    setConnection("idle");
  }, [cleanupAnswer]);
  useEffect(() => { teardownSessionRef.current = teardownSession; }, [teardownSession]);

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

  // One path to the speech proxy for everything the interviewer says. That single path is what
  // lets the server verify every utterance against the authored questions and the approved phrase
  // bank (backend/utils/speechAuthorization.js).
  const fetchAudioUrl = useCallback(async (text) => {
    const once = async () => {
      const res = await api.post(
        "/interview-portal/voice/speak",
        { text },
        { headers: authHeader(), responseType: "blob" }
      );
      return URL.createObjectURL(res.data);
    };
    try {
      return await once();
    } catch (err) {
      // One retry, and only for the failures a retry can fix. A refusal (422 — the text was not
      // authored) or an auth failure will fail identically the second time, and retrying a
      // deliberate refusal is the wrong instinct in a mechanism that exists to refuse.
      //
      // The retry matters more than it looks: without it, one dropped request mid-interview
      // switches the interviewer's voice to the browser's robot for that sentence, and a voice
      // that changes halfway through is more unsettling than a pause.
      const status = err?.response?.status;
      if (status && status !== 429 && status < 500) throw err;
      return once();
    }
  }, []);

  // The server refused to speak this text because it was not an authored turn or an approved
  // phrase. The browser must NOT then read it aloud itself — routing around the check with local
  // speech synthesis would defeat the entire point of having it.
  async function isNotAuthored(err) {
    if (err?.response?.status !== 422) return false;
    const data = err.response.data;
    if (data?.code === "SPEECH_NOT_AUTHORED") return true;
    // responseType is "blob", so an error body arrives as a Blob rather than parsed JSON.
    if (typeof data?.text === "function") {
      try {
        return JSON.parse(await data.text())?.code === "SPEECH_NOT_AUTHORED";
      } catch {
        return false;
      }
    }
    return false;
  }

  // Ask the server to authorise a question and hand back a streaming URL.
  //
  // Questions go down this path instead of the buffered one because they are long and they are
  // the only thing a candidate is ever waiting on. A buffered question is synthesised whole on
  // the server, transferred whole, and only then played — a second or more of silence before
  // every question, none of which buys anything, since the first clause is ready long before the
  // last one is. Handing the <audio> element a streaming URL gets native progressive playback:
  // the voice starts on the opening words.
  //
  // Short phrases — backchannels, preambles, meta answers — stay on the buffered endpoint. They
  // are pre-synthesised once and cached for the whole session, so streaming them would add a
  // round trip and save nothing.
  const fetchQuestionStream = useCallback(async (text) => {
    const { data } = await api.post(
      "/interview-portal/voice/speak/stream",
      { text },
      { headers: authHeader() }
    );
    if (!data?.ticket) throw new Error("no ticket");
    const base = (api.defaults.baseURL || "").replace(/\/$/, "");
    return {
      // The ticket is the whole credential — no session token goes into this URL, because a URL
      // ends up in browser history and access logs. It names one sentence the server already
      // approved and can be used to say nothing else.
      url: `${base}/interview-portal/voice/speak/stream/${data.ticket}`,
      estimatedMs: Number(data.estimatedMs) || 0,
    };
  }, []);

  const playUrl = useCallback(
    (url) =>
      new Promise((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        speakingRef.current.audio = audio;
        // Resolve exactly once, whoever gets there first: the audio finishing, the audio failing,
        // or stopSpeaking cutting it off for a barge-in.
        const done = () => {
          if (playbackResolveRef.current === done) playbackResolveRef.current = null;
          resolve();
        };
        playbackResolveRef.current = done;
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      }),
    []
  );

  // Every route by which the interviewer makes a sound goes through this, so the echo gate always
  // knows what to strike transcripts against. Nothing else may set speakingRef: an utterance that
  // played without being registered here is one the microphone would hear and attribute to the
  // candidate, and it would land in their answer as if they had said it.
  const withSpokenText = useCallback(async (text, play) => {
    speakingRef.current = { text: String(text || ""), audio: null };
    try {
      return await play();
    } finally {
      // Cleared BEFORE the caller resumes listening. A stale reference would keep explaining the
      // candidate's real words away as echo of a sentence that has already finished.
      speakingRef.current = { text: "", audio: null };
    }
  }, []);

  // How far through the current utterance playback is, as 0-1, or undefined when it cannot be
  // known (browser speech-synthesis fallback, or audio that has not started). Undefined is the
  // conservative reading: the gate then compares against the whole utterance, which explains away
  // more and interrupts less.
  function spokenRatio() {
    const audio = speakingRef.current.audio;
    if (!audio) return undefined;
    // A STREAMED response has no Content-Length, so `duration` reads Infinity until enough has
    // buffered. Falling straight through to undefined would leave the echo gate comparing every
    // transcript against the whole question for the first seconds of every question — which
    // explains away more and lets fewer real interruptions through, exactly when a candidate is
    // most likely to cut in. The server's estimate covers that window; the real duration replaces
    // it the moment the browser has one.
    if (audio.duration > 0 && Number.isFinite(audio.duration)) {
      return Math.min(1, Math.max(0, audio.currentTime / audio.duration));
    }
    const estimate = spokenEstimateRef.current;
    if (estimate > 0 && audio.currentTime > 0) {
      return Math.min(1, Math.max(0, (audio.currentTime * 1000) / estimate));
    }
    return undefined;
  }

  // Is that the candidate, or is it us? Consulted for every transcript that arrives while the
  // interviewer has a voice in the air.
  function readEcho(transcript) {
    return classifyEcho(transcript, {
      spokenText: speakingRef.current.text,
      spokenRatio: spokenRatio(),
      policy: policyRef.current.echo,
    });
  }

  // Synthesize the backchannel phrases up front so a reassurance can land promptly when the
  // candidate actually falls silent — waiting on a TTS round-trip to say "take your time" would
  // arrive after the moment it was meant for. Cached per phrase, so the whole interview pays for
  // each phrase once.
  const primeBackchannels = useCallback(
    (phrases) => {
      for (const phrase of phrases || []) {
        if (!phrase || bcCacheRef.current.has(phrase)) continue;
        bcCacheRef.current.set(phrase, fetchAudioUrl(phrase).catch(() => null));
      }
    },
    [fetchAudioUrl]
  );

  // Say something non-evaluative.
  //
  // THE MICROPHONE NO LONGER CLOSES FOR THIS. It used to: capture was paused around playback so
  // the interviewer's own voice could not be transcribed into the candidate's answer. The cost was
  // a real one — a candidate who started talking over "take your time" lost that fragment, which
  // is precisely the moment someone finally finds the word they were reaching for.
  //
  // With the echo gate (portal/echoAlignment.js) the microphone can stay open through our own
  // speech, because what comes back is compared against what we are saying and struck out. So the
  // candidate can talk over anything the interviewer says, on any device, and nothing they say is
  // lost. `fullDuplex: false` restores the old pausing behaviour exactly.
  const playBackchannel = useCallback(
    async (phrase) => {
      if (!phrase || bcBusyRef.current) return;
      bcBusyRef.current = true;
      const duplex = policyRef.current.echo.fullDuplex;
      const rec = recorderRef.current;
      try {
        if (!duplex && rec && rec.state === "recording") rec.pause();
      } catch { /* ignore */ }
      setBackchannel(phrase);
      try {
        await withSpokenText(phrase, async () => {
          let pending = bcCacheRef.current.get(phrase);
          if (!pending) {
            pending = fetchAudioUrl(phrase).catch(() => null);
            bcCacheRef.current.set(phrase, pending);
          }
          const url = await pending;
          // No browser-TTS fallback here, deliberately. A backchannel is OPTIONAL speech — "take
          // your time", "thank you" — and saying it in a different voice from the one that has
          // been conducting the interview is worse than not saying it. The candidate briefly gets
          // a quieter interviewer; they do not get a second stranger. A QUESTION is different and
          // still falls back (see `speak`), because a question they never hear is a question they
          // cannot answer, and it is on screen to read either way.
          if (url) await playUrl(url);
        });
      } finally {
        setBackchannel("");
        audioRef.current = null;
        try {
          if (recorderRef.current && recorderRef.current.state === "paused") recorderRef.current.resume();
        } catch { /* ignore */ }
        bcBusyRef.current = false;
      }
    },
    [fetchAudioUrl, playUrl, withSpokenText]
  );

  // `state` is the endpointing verdict this wait was chosen for ("holding" | "ambiguous" |
  // "complete"), carried through so the handler that eventually fires knows whether the
  // candidate was mid-thought or finished — and therefore whether to offer time or move on.
  const armSilence = useCallback((ms, state = "ambiguous") => {
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      handleSilenceRef.current?.(state);
    }, ms);
  }, []);

  // Silence, handled as a conversation rather than a deadline.
  //
  // The old behaviour was: provider reports silence -> 4s grace -> submit. A candidate pausing to
  // find a word had their turn ended mid-thought, and a candidate who hadn't started speaking at
  // all got nothing whatsoever — just an open mic and no acknowledgement they existed. Now
  // silence first buys reassurance and a much longer window, and only becomes the end of the turn
  // once the reassurance budget for this turn is spent.
  //
  // The budget is per TURN, not per pause: speaking again does not refill it. Otherwise a
  // candidate who pauses often would be reassured indefinitely and the turn could never end.
  const handleSilence = useCallback(async (endState = "ambiguous") => {
    const acc = sessionRef.current;
    if (!acc || endedRef.current) return;
    // A reassurance is already mid-playback. Don't stack another on top of it — the in-flight
    // call re-arms the timer itself when it finishes.
    if (bcBusyRef.current) return;
    const policy = policyRef.current;
    const answerSoFar = (acc.finalText || "").trim();
    const spokeSomething = Boolean(answerSoFar);
    const answerWords = (answerSoFar.match(/[A-Za-z0-9']+/g) || []).length;

    // How much doubt is there, really?
    //
    // `substantial` means they have said enough for this to be a whole answer rather than an
    // opening sentence; `settled` means the classifier heard a completed clause with the voice
    // falling away AND there is a real answer behind it. Those two together are the case where
    // every further second of patience is pure latency — the candidate finished, and the
    // interviewer is still performing attentiveness at them.
    const substantial = answerWords >= policy.settledMinWords;
    const settled = endState === "complete" && substantial;

    // Reassurance is for someone who is MID-THOUGHT or who has not started. It used to fire on
    // anything that was not classified "complete", which meant a finished 60-word answer whose
    // last transcript chunk happened to arrive without a full stop got "take your time — I'm
    // here", then nine seconds, then it again, then nine more. Half a minute of being comforted
    // for having already answered. Spontaneous speech loses its terminal punctuation constantly,
    // so that was not an edge case; it was most turns.
    const needsTime = endState === "holding" || !substantial;

    if (needsTime && reassureRef.current < policy.maxReassurancesPerTurn) {
      const index = reassureRef.current;
      reassureRef.current += 1;
      setEndingSoon(false);
    setEndsAt(0);
      const phrase = policy.reassurances[(turnCounterRef.current + index) % policy.reassurances.length];
      await playBackchannel(phrase);
      bcEventsRef.current.push({ kind: "reassure", phrase, at: Date.now() });
      if (endedRef.current || !sessionRef.current) return;
      // Having just told the candidate to take their time, wait long enough to mean it.
      armSilence(spokeSomething ? policy.postReassuranceGraceMs : policy.initialSilenceMs * 2, endState);
      return;
    }

    // Out of reassurance. An answer that exists can now be treated as finished — but an answer
    // that was never started must NOT be auto-submitted as empty. That candidate keeps the mic
    // and the visible "Done" button for as long as they need, and is not nagged further.
    if (!spokeSomething) return;

    // A complete, substantial answer. Take them at their word and hand the floor back.
    //
    // This is where ~6.5 seconds per turn used to go: the interviewer asked "anything you'd like
    // to add?" after EVERY answer and then waited five more seconds for a reply it had no reason
    // to expect. A person who has just finished explaining something does not get asked whether
    // they have finished; they get an acknowledgement and the next question. The check-in below
    // still exists, and still fires wherever there is real doubt — it just stopped being the
    // toll every candidate pays on every turn.
    //
    // The candidate is not stranded if we are wrong: `acknowledge()` speaks over the submit and
    // they can talk straight over it and over the next question (utils/echoAlignment.js), which
    // is a better safety net than a silent countdown because they can hear that it worked.
    if (settled) {
      setEndingSoon(true);
      setEndsAt(Date.now() + policy.settledGraceMs);
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        if (!endedRef.current) {
          endedRef.current = true;
          autoEndRef.current?.();
        }
      }, policy.settledGraceMs);
      return;
    }

    // Ask before ending rather than just ending. Candidates report the old behaviour as being
    // cut off — the turn stopped on a timer while they were still gathering the rest of their
    // answer. Asking hands the decision back to them, and any new speech cancels the ending
    // outright (the socket handler clears this timer on the next transcript). It costs a few
    // seconds instead of the fixed minute-long wait that would otherwise be needed to feel
    // unhurried, and unlike a silent countdown the candidate can hear it happening.
    const confirmations = policy.confirmations;
    if (confirmations.length && !confirmedRef.current) {
      confirmedRef.current = true;
      const phrase = confirmations[turnCounterRef.current % confirmations.length];
      await playBackchannel(phrase);
      bcEventsRef.current.push({ kind: "confirm", phrase, at: Date.now() });
      if (endedRef.current || !sessionRef.current) return;
      setEndingSoon(true);
      setEndsAt(Date.now() + policy.confirmGraceMs);
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        if (!endedRef.current) {
          endedRef.current = true;
          autoEndRef.current?.();
        }
      }, policy.confirmGraceMs);
      return;
    }

    setEndingSoon(true);
    setEndsAt(Date.now() + policy.endingGraceMs);
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      if (!endedRef.current) {
        endedRef.current = true;
        autoEndRef.current?.();
      }
    }, policy.endingGraceMs);
  }, [armSilence, playBackchannel]);

  useEffect(() => { handleSilenceRef.current = handleSilence; }, [handleSilence]);

  // Speak a question. Resolves when playback finishes (or fails over to browser TTS).
  //
  // The audio is KEPT (not revoked) until the next question replaces it, so a candidate who asks
  // "sorry, could you repeat that?" hears the identical bytes rather than a fresh synthesis. That
  // is both free and the stronger guarantee: a repeat cannot drift from what was first asked.
  const speak = useCallback(
    async (text, { restatement = "" } = {}) => {
      if (!text) return;
      stopSpeaking(); // never let an acknowledgement still playing overlap the next question
      setPhase("speaking");
      if (questionAudioRef.current?.startsWith("blob:")) URL.revokeObjectURL(questionAudioRef.current);
      questionAudioRef.current = null;
      questionRef.current = text;
      restatementRef.current = String(restatement || "");
      repeatsRef.current = 0;
      try {
        // Streamed, not buffered: the voice starts on the opening words rather than after the
        // whole file has been synthesised and transferred. The URL is kept so a repeat replays
        // the same ticket — and therefore the identical bytes, which the server caches for
        // exactly that reason.
        const { url, estimatedMs } = await fetchQuestionStream(text);
        questionAudioRef.current = url;
        spokenEstimateRef.current = estimatedMs;
        await withSpokenText(text, () => playUrl(url));
        audioRef.current = null;
      } catch (err) {
        // Any ordinary failure (offline, provider down) falls back to the browser's own voice so a
        // question is always heard. A refusal is different: the text was not verified as part of
        // this interview, so it is shown on screen and NOT read aloud by any route.
        if (await isNotAuthored(err)) {
          setError("The interviewer couldn't read that question aloud — please read it on screen and answer as normal.");
        } else {
          await withSpokenText(text, () => browserSpeak(text));
        }
      } finally {
        spokenEstimateRef.current = 0;
        setPhase((p) => (p === "speaking" ? "idle" : p));
      }
    },
    [fetchQuestionStream, playUrl, stopSpeaking]
  );

  // Re-ask the current question, verbatim. Nothing is re-generated: the same authored text and,
  // when it is still held, the same audio. Repeating a *different* question would quietly hand
  // this candidate a different test from everyone else's.
  const repeatQuestion = useCallback(async ({ preambles: overridePreambles, restate = false } = {}) => {
    // `restate` is the clarify path: they heard it and did not understand it, so say the
    // recruiter-approved rewording instead of the same sentence again.
    //
    // When no rewording was authored we do NOT improvise one — composing a question in the moment
    // would mean this candidate was measurably asked something different from everyone else, and
    // it would be the candidates who needed help most who got the non-standard test. We fall back
    // to an honest repeat instead: the old behaviour announced "let me put that a different way"
    // and then replayed the identical sentence, which is a promise broken in the same breath.
    const text = (restate && restatementRef.current) || questionRef.current;
    const isRestating = restate && Boolean(restatementRef.current);
    if (!text || repeatBusyRef.current) return;
    repeatBusyRef.current = true;
    const duplex = policyRef.current.echo.fullDuplex;
    const rec = recorderRef.current;
    try {
      if (!duplex && rec && rec.state === "recording") rec.pause();
    } catch { /* ignore */ }
    try {
      // The framing has to match what actually follows it. `overridePreambles` (clarify) is only
      // honoured when there IS a rewording to deliver; otherwise we drop back to the repeat
      // preamble, because announcing a different wording and then producing the same one is the
      // exact behaviour this path was built to remove.
      const preambles =
        isRestating && overridePreambles?.length ? overridePreambles : policyRef.current.repeatPreambles;
      if (preambles.length) {
        const preamble = preambles[(repeatsRef.current - 1 + preambles.length) % preambles.length];
        setBackchannel(preamble);
        await withSpokenText(preamble, async () => {
          const cached = bcCacheRef.current.get(preamble);
          const url = cached ? await cached : null;
          if (url) await playUrl(url);
          else await browserSpeak(preamble);
        });
      }
      setBackchannel(text);
      await withSpokenText(text, async () => {
        // A plain repeat replays the SAME audio bytes, which is both free and the stronger
        // guarantee — it cannot drift from what was first asked. A restatement is different text,
        // so it is synthesised (once, then cached for the rest of this question's repeats).
        if (isRestating) {
          let pending = bcCacheRef.current.get(text);
          if (!pending) {
            pending = fetchAudioUrl(text).catch(() => null);
            bcCacheRef.current.set(text, pending);
          }
          const url = await pending;
          if (url) await playUrl(url);
          else await browserSpeak(text);
          return;
        }
        if (questionAudioRef.current) await playUrl(questionAudioRef.current);
        else await browserSpeak(text);
      });
    } finally {
      setBackchannel("");
      audioRef.current = null;
      try {
        if (recorderRef.current && recorderRef.current.state === "paused") recorderRef.current.resume();
      } catch { /* ignore */ }
      repeatBusyRef.current = false;
    }
  }, [playUrl, withSpokenText, fetchAudioUrl]);

  // Called from the live socket handler, so it has to be a ref (the handler is installed once).
  useEffect(() => { repeatQuestionRef.current = repeatQuestion; }, [repeatQuestion]);

  // ---- The semantic intent tier -------------------------------------------
  //
  // Consulted only where the trigger lists above are silent. That ordering is the whole design:
  // the common phrasings are answered here, instantly and for free, and the network round-trip is
  // spent only on the tail — the phrasings a list was never going to cover.
  //
  // The server owns the reading (backend/services/intentService.js) AND the closed set of things
  // it may resolve to. This function only decides WHEN to ask and carries out the result.
  // In-flight and completed lookups for this turn, keyed by the exact utterance. This is what
  // makes the tier feel instant rather than adding a beat of silence before the interviewer
  // reacts: the lookup is STARTED on the interim transcript, while the candidate is still
  // finishing the sentence, and by the time the final arrives the answer is usually already here.
  //
  // The policy comment has always described it working this way; the code only ever called it on
  // finals, so every unusual phrasing cost a full round trip of dead air after the candidate
  // stopped talking. Prefetching changes only WHEN the question is asked, never what is done with
  // it — the result is still acted on solely against the final transcript, and a prefetch whose
  // text the final does not match is simply dropped.
  const intentCacheRef = useRef(new Map());

  const askSemanticIntent = useCallback(async (utterance, answerSoFar) => {
    const policy = policyRef.current.intent;
    if (!policy.semanticEnabled) return null;
    const words = (String(utterance || "").match(/[A-Za-z0-9']+/g) || []).length;
    // Bounded on both sides before spending anything: too short to carry an intent, or long enough
    // that it is an answer whatever else it contains.
    //
    // The upper bound is `maxUtteranceWords`, NOT `maxMetaWords`. The tighter number is applied
    // server-side once the action is known, where "finished" can be exempted — a hand-back is long
    // precisely because they were finishing an answer, so cutting the lookup off at 25 words made
    // that reading unreachable for the way people actually end a sentence.
    if (words < policy.minWordsForLookup || words > policy.maxUtteranceWords) return null;

    // Already asked this exact question during this turn — reuse it rather than paying twice. This
    // is what turns the interim prefetch into a latency saving instead of a duplicate call.
    const key = String(utterance || "").trim();
    const cached = intentCacheRef.current.get(key);
    if (cached) return cached;

    const pending = (async () => {
      try {
        const { data } = await api.post(
          "/interview-portal/voice/intent",
          { utterance, answerSoFar },
          { headers: authHeader(), timeout: policy.timeoutMs }
        );
        return data || null;
      } catch {
        // Timeout, offline, rate limit, provider outage — all the same answer. The interview never
        // waits on this path and never fails because of it: not understanding an unusual phrasing
        // leaves the interviewer exactly as perceptive as it was before this tier existed.
        return null;
      }
    })();

    intentCacheRef.current.set(key, pending);
    return pending;
  }, []);
  const askSemanticIntentRef = useRef(askSemanticIntent);
  useEffect(() => { askSemanticIntentRef.current = askSemanticIntent; }, [askSemanticIntent]);

  // Speak a sentence the SERVER composed for this moment — today, the answer to a question about
  // the interview ("there are three more to go"). It is played through the same authorised path as
  // everything else: the server wrote it into the transcript as a turn before returning it, which
  // is what makes it speakable at all (backend/utils/speechAuthorization.js).
  const speakServerText = useCallback(
    async (text) => {
      if (!text) return;
      setBackchannel(text);
      try {
        await withSpokenText(text, async () => {
          try {
            const url = await fetchAudioUrl(text);
            await playUrl(url);
            URL.revokeObjectURL(url);
          } catch {
            await browserSpeak(text);
          }
        });
      } finally {
        setBackchannel("");
        audioRef.current = null;
      }
    },
    [fetchAudioUrl, playUrl, withSpokenText]
  );
  const speakServerTextRef = useRef(speakServerText);
  useEffect(() => { speakServerTextRef.current = speakServerText; }, [speakServerText]);

  // Acknowledge out loud that an answer landed, filling the dead air while the next question is
  // prepared. Called with the microphone already closed, so there is nothing to pause.
  // Fire-and-forget playback; returns the event so the CALLER can attribute it to the answer it
  // belongs to (this runs after finishListening has already handed back that turn's list).
  const acknowledge = useCallback(() => {
    const list = policyRef.current.acknowledgements;
    if (!list.length) return null;
    const phrase = list[turnCounterRef.current % list.length];
    void playBackchannel(phrase);
    return { kind: "acknowledge", phrase, at: Date.now() };
  }, [playBackchannel]);

  // The same move for a declined question — "that's no problem, let's move on" — played once the
  // mic is closed, while the next question is prepared.
  //
  // It is a SEPARATE bank from `acknowledge` for one reason: this is the phrase a candidate hears
  // at the most exposed moment of the interview, having just said they can't answer something.
  // The wording that belongs there is worth being able to review on its own, and it must be as
  // uniform across candidates as every other phrase here — warmth that varies with how badly
  // someone is doing is differential encouragement, not kindness.
  const acknowledgeDecline = useCallback(() => {
    const list = policyRef.current.declineReplies;
    if (!list.length) return null;
    const phrase = list[turnCounterRef.current % list.length];
    void playBackchannel(phrase);
    return { kind: "decline", phrase, at: Date.now() };
  }, [playBackchannel]);

  // Open the mic and the transcription socket.
  //
  // `armTurnClock: false` opens everything WITHOUT starting the turn's silence handling — used by
  // barge-in, where the mic goes live before the question is spoken. Arming the clock then would
  // have the interviewer reassuring the candidate for not answering a question it is still asking.
  // Start a new turn. The MICROPHONE AND THE SOCKET ARE NOT PART OF A TURN.
  //
  // They used to be: every question tore down the stream, the WebSocket, the recorder and the
  // audio graph and rebuilt them from scratch, which cost a token grant, a getUserMedia call and a
  // WebSocket handshake — roughly a second — on every single question, and left the candidate
  // talking into nothing for the whole gap while the next question was prepared and spoken. That
  // gap is where "oh, one more thing" lives, which is the most human moment in an interview and
  // was the one moment nothing was listening.
  //
  // So this is now idempotent about the session and fresh about the turn: an already-live session
  // is reused, and only the per-answer state is reset. `beginTurn` below is the part that always
  // runs.
  const openMic = useCallback(async ({ armTurnClock = true } = {}) => {
    if (!supported) throw new Error("unsupported");
    setError("");
    setInterim("");
    setEndingSoon(false);
    setEndsAt(0);
    endedRef.current = false;
    reassureRef.current = 0;
    confirmedRef.current = false;
    bcEventsRef.current = [];
    // Per TURN, not per session: the same words mean different things after different questions
    // ("sorry, what?" is a repeat after one and a clarify after another), and the classifier is
    // given the question in flight as context. Carrying a reading across turns would apply an
    // answer about the last question to this one.
    intentCacheRef.current.clear();
    turnCounterRef.current += 1;
    // Clears any interviewer audio still playing before the mic opens. On the barge-in path the
    // mic deliberately opens BEFORE the question is spoken (see askAndListen), so this runs first
    // and there is nothing to cut off; on the turn-based path the question has already finished.
    stopSpeaking();

    // Everything a TURN needs, and nothing a session does. Always runs, including on the fast
    // path where the stream and socket are already live from the previous question.
    const beginTurn = () => {
      const acc = {
        finalText: "",
        lastInterim: "",
        confidence: 0,
        startedAt: Date.now(),
        energy: [],
        speakerWords: {},
        // What the CONNECTION did during this answer. A transcript recorded across a dropped
        // socket is missing words, and the report has to be able to say so.
        drops: 0,
        gapMs: 0,
        lost: false,
        // What they said in the gap before this question — kept with the answer it followed, as a
        // condition of the interview, never appended to anything.
        spokeBetweenTurns: betweenTurnsRef.current.text || "",
      };
      sessionRef.current = acc;
      betweenTurnsRef.current = { text: "", at: 0 };
      if (betweenTurnsIdleRef.current) clearTimeout(betweenTurnsIdleRef.current);
      betweenTurnsIdleRef.current = null;
      setSpeakingBetweenTurns(false);
      startSamplerRef.current?.();
      if (armTurnClock) {
        setPhase("listening");
        armSilence(policyRef.current.initialSilenceMs);
      }
      return acc;
    };

    // A live session is reused whole. This is the fast path and it is the common one — after the
    // first question, opening the mic costs nothing at all.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && streamRef.current?.active) {
      beginTurn();
      return;
    }

    const { data: cred } = await api.get("/interview-portal/voice/token", { headers: authHeader() });
    policyRef.current = normalizePolicy(cred.conversation);
    if (cred.persona?.name) setPersonaName(cred.persona.name);
    // Kick off (don't await) synthesis of what we might need to say during this turn.
    primeBackchannels([
      ...policyRef.current.reassurances,
      ...policyRef.current.acknowledgements,
      ...policyRef.current.repeatPreambles,
      ...policyRef.current.confirmations,
      ...policyRef.current.bridges,
      // The dialogue-act replies matter most here: a decline or a request to stop needs an
      // answer in the moment, and waiting on a TTS round-trip lands it after the moment passed.
      ...policyRef.current.declineReplies,
      ...policyRef.current.withdrawConfirmations,
      ...policyRef.current.withdrawCancellations,
      ...policyRef.current.pauseReplies,
      ...policyRef.current.clarifyPreambles,
      ...policyRef.current.technicalReplies,
    ]);
    // Whether the candidate can interrupt on THIS device, known only once the server's policy has
    // arrived. Surfaced so the room can say so out loud — an interviewer you are allowed to talk
    // over is no use if nobody tells you.
    setCanInterrupt(Boolean(policyRef.current.echo.fullDuplex));

    // Echo cancellation requested explicitly, not left to the browser default. It is the reason
    // the microphone can be open while the interviewer talks at all, and "usually on by default"
    // is not a basis for that decision. Measured for real at pre-check (portal/audioIsolation.js).
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    streamRef.current = stream;

    const p = cred.stt || {};
    const params = new URLSearchParams({
      model: p.model || "nova-3",
      language: p.language || "en",
      interim_results: "true",
      utterance_end_ms: String(p.utteranceEndMs || 3200),
      punctuate: "true",
      smart_format: "true",
    });
    // Speaker separation, when the server enabled it. Costs nothing extra on the socket we already
    // open, and turns "someone else answered this question" from invisible into measurable. We
    // report only word COUNTS per speaker (below) — never who, never a voiceprint, never audio.
    if (p.diarize) params.set("diarize", "true");
    // Vocabulary biasing so technical nouns survive transcription ("Kubernetes" not "cooper
    // netties"). The server decides both the terms (backend/utils/keyterms.js) and the param
    // name the provider expects, so this stays provider-agnostic and the client never has to
    // know which speech vendor or model generation is behind it.
    for (const term of p.keyterms || []) params.append(p.keytermParam || "keyterm", term);
    // Browsers can't set WS headers, but Deepgram accepts the short-lived token as a WebSocket
    // subprotocol (Sec-WebSocket-Protocol: "bearer, <token>"). Passing it as an ?access_token=
    // query param is NOT accepted and silently fails the handshake — verified against the live
    // API. The raw DEEPGRAM_API_KEY still never reaches the browser (only this ~60s token does).
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    // `speakerWords` tallies words per diarization label for THIS answer. Counts only — no
    // voiceprint, no identity, nothing that could follow a candidate anywhere. Whether these
    // numbers amount to "a second person answered" is decided server-side (utils/proctoring.js),
    // because that is a judgement and the browser is an untrusted reporter.
    //
    // `drops` / `gapMs` / `lost` record what the CONNECTION did during this answer. They travel
    // with the transcript on submit, because a transcript recorded across a dropped socket is
    // missing words and the report has to be able to say so.
    // Sample the RMS-energy envelope ~10x/sec for pause-ratio + energy-variance (prosody).
    // Per-TURN, unlike the stream and the socket: an energy envelope belongs to one answer.
    const startSampler = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const audioCtx = new Ctx();
        audioCtxRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        audioCtx.createMediaStreamSource(streamRef.current).connect(analyser);
        const frame = new Float32Array(analyser.fftSize);
        samplerRef.current = setInterval(() => {
          const live = sessionRef.current;
          if (!live || !analyser.getFloatTimeDomainData) return;
          analyser.getFloatTimeDomainData(frame);
          let sum = 0;
          for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
          live.energy.push(Math.sqrt(sum / frame.length));
        }, 100);
      } catch { /* prosody is best-effort — never block the interview */ }
    };
    startSamplerRef.current = startSampler;

    // Named rather than assigned straight onto the socket, because a reconnect has to re-attach
    // the SAME handler to a new socket.
    //
    // It reads the CURRENT turn from `sessionRef` rather than closing over one, because the socket
    // now outlives the turn (see openMic) — a captured accumulator would keep filling the answer
    // the candidate finished two questions ago. Everything downstream still captures `acc` locally
    // and re-checks `sessionRef.current !== acc`, which is what makes an async reaction arriving
    // after the turn moved on get dropped rather than applied to the wrong answer.
    const handleMessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const acc = sessionRef.current;

      // Between turns. The socket stays open while the next question is prepared and spoken, so
      // this is a candidate saying "oh — and one more thing" into what used to be a dead
      // microphone. It is NOT appended to anything: it belongs to the answer they just gave, not
      // to the question they are about to be asked, and quietly filing it under the wrong question
      // would be worse than losing it. It is kept so the room can hold the next question until
      // they have finished, and reported on submit as a condition of the interview.
      if (!acc) {
        if (msg.type !== "Results") return;
        const heard = msg.channel?.alternatives?.[0]?.transcript || "";
        if (!heard.trim()) return;
        if (speakingRef.current.text && readEcho(heard).verdict === "echo") return;
        betweenTurnsRef.current = {
          text: `${betweenTurnsRef.current.text} ${heard}`.trim().slice(-500),
          at: Date.now(),
        };
        setSpeakingBetweenTurns(true);
        // Release the hold once they actually stop. Without this the next question would never be
        // asked at all — the room waits on this flag, so a flag that only ever turns on is a
        // deadlock, and the deadlock would look to the candidate exactly like the interview
        // freezing after their answer.
        if (betweenTurnsIdleRef.current) clearTimeout(betweenTurnsIdleRef.current);
        betweenTurnsIdleRef.current = setTimeout(() => {
          betweenTurnsIdleRef.current = null;
          setSpeakingBetweenTurns(false);
        }, BETWEEN_TURNS_IDLE_MS);
        return;
      }

      if (msg.type === "UtteranceEnd") {
        // The provider has seen a short burst of silence after speech. That is a PROMPT to
        // decide, not the decision: classify what was just said and pick the waiting window from
        // its shape. Trailing on "and…" or a filler waits generously; a completed sentence with
        // the voice falling away responds in under a second. Replaces the flat timer that was
        // cutting candidates off mid-thought (and, on finished answers, leaving them in silence).
        if (endedRef.current) return;
        const verdict = classify(acc.finalText || acc.lastInterim, {
          energy: acc.energy,
          policy: policyRef.current.endpointing,
        });
        // Recorded so "why did my turn end there?" is answerable from the session afterwards.
        acc.endOfTurn = { state: verdict.state, reason: verdict.reason };
        setEndingSoon(false);
    setEndsAt(0);
        armSilence(verdict.waitMs, verdict.state);
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      let t = alt?.transcript || "";
      if (!t) return;

      // ---- Is this the candidate, or is it us? --------------------------------
      //
      // The microphone is open while the interviewer speaks, so on any device without headphones
      // some of what arrives here is our own voice. Strike out everything the sentence we are
      // currently saying accounts for; what is left is a person (portal/echoAlignment.js).
      //
      // Runs on interims as well as finals, because the barge-in reaction has to be immediate —
      // waiting for a final would mean interrupting a second after they started.
      if (speakingRef.current.text) {
        const heard = readEcho(t);
        if (heard.verdict === "echo") {
          // Our own voice. It is not the candidate's answer, it is not a reason to cancel the
          // silence timer, and it must not reach the transcript.
          return;
        }
        // Real speech over our own. `residue` is what they said with our words removed, so their
        // turn starts with their sentence rather than with the tail of our question.
        t = heard.residue || t;

        // Barge-in: stop reading and listen, which is what a person would do. Armed only while a
        // QUESTION is in flight — talking over a backchannel is welcome and captured, but it is
        // not an interruption of anything, so there is nothing to stop.
        if (bargeInArmedRef.current && t.trim().length >= BARGE_IN_MIN_CHARS) {
          bargeInArmedRef.current = false;
          onBargeInRef.current?.();
        }
      }

      // Real speech arrived — cancel any pending silence timer (a reassurance about to fire, or a
      // countdown to auto-submit). The candidate answered it by talking again.
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      setEndingSoon(false);
    setEndsAt(0);
      if (msg.is_final) {
        // What the answer was before this utterance landed. Kept so a dialogue act can be undone
        // cleanly: if the candidate asks to stop and then says "no, carry on", the words they had
        // already spoken are still their answer and must come back intact.
        const beforeThisFinal = acc.finalText;
        acc.finalText = `${acc.finalText} ${t}`.trim();
        acc.lastInterim = "";
        if (alt.confidence) acc.confidence = Math.max(acc.confidence, alt.confidence);
        setInterim(acc.finalText);

        // Tally diarization labels on finals only (interims get revised). Skipped whenever the
        // interviewer has a voice in the air — not just during a question, now that the mic also
        // stays open through backchannels. The microphone is deliberately open over our own voice
        // on every one of those paths, and labelling the interviewer as a second speaker would
        // raise a proctoring flag against the candidate for our design decision.
        if (!speakingRef.current.text && Array.isArray(alt.words)) {
          for (const w of alt.words) {
            if (!Number.isFinite(w?.speaker)) continue;
            acc.speakerWords[w.speaker] = (acc.speakerWords[w.speaker] || 0) + 1;
          }
        }

        const policy = policyRef.current;

        // ---- Dialogue acts: the candidate talking ABOUT the interview ----
        //
        // Checked before everything else because these are the utterances that must not be read
        // as answers. See portal/dialogueActs.js; the server re-checks all of it.

        // A withdrawal is awaiting confirmation, so this utterance is a reply to "would you like
        // to end the interview here?" — not an answer to the interview question. Either way it is
        // removed from the answer: it was speech about the interview, not evidence in it.
        if (withdrawRef.current && !endedRef.current) {
          const pendingWithdraw = withdrawRef.current;
          const reply = detectConfirmation(t, policy.acts);
          acc.finalText = pendingWithdraw.priorText;
          setInterim(pendingWithdraw.priorText);
          if (pendingWithdraw.timer) clearTimeout(pendingWithdraw.timer);
          withdrawRef.current = null;

          if (reply === "yes") {
            if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
            setEndingSoon(false);
    setEndsAt(0);
            endedRef.current = true;
            actRef.current?.({
              act: "withdraw",
              text: pendingWithdraw.requestText,
              confirmText: t,
              confirmedBy: "spoken",
            });
            return;
          }

          // "No", or anything unrecognisable. Both resume the interview — the default here is
          // always to carry on, because that is the error a candidate can recover from.
          void (async () => {
            const list = policy.withdrawCancellations;
            if (list.length) {
              const phrase = list[turnCounterRef.current % list.length];
              await playBackchannel(phrase);
              bcEventsRef.current.push({ kind: "withdraw_cancel", phrase, at: Date.now() });
            }
            if (endedRef.current || !sessionRef.current) return;
            armSilence(policy.initialSilenceMs);
          })();
          return;
        }

        const act = detectAct(acc.finalText, policy.acts);

        // "I want to stop." Never acted on directly — the interviewer asks first, and only an
        // explicit yes ends anything. Silence, a no, and an unrecognisable mumble all carry on.
        if (act.honour && act.act === "withdraw" && policy.withdrawConfirmations.length && !endedRef.current) {
          if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
          setEndingSoon(false);
    setEndsAt(0);
          withdrawRef.current = { requestText: acc.finalText, priorText: beforeThisFinal, timer: null };
          void (async () => {
            const phrase = policy.withdrawConfirmations[0];
            await playBackchannel(phrase);
            bcEventsRef.current.push({ kind: "withdraw_confirm", phrase, at: Date.now() });
            if (endedRef.current || !sessionRef.current || !withdrawRef.current) return;
            withdrawRef.current.timer = setTimeout(() => {
              // They said nothing. The interview continues, and the words they had spoken before
              // asking are restored as their answer.
              const stale = withdrawRef.current;
              withdrawRef.current = null;
              if (endedRef.current || !sessionRef.current) return;
              acc.finalText = stale?.priorText ?? acc.finalText;
              setInterim(acc.finalText);
              armSilence(policy.initialSilenceMs);
            }, policy.acts.withdrawConfirmGraceMs);
          })();
          return;
        }

        // "I don't know." A complete turn, ended immediately — there is nothing to wait for, and
        // making someone sit through a silence timer after admitting they can't answer is the
        // most machine-like thing this interviewer could do. The room submits it as a DECLINE, not
        // as an answer, which is what keeps it out of the score.
        if (act.honour && act.act === "decline" && policy.declineReplies.length && !endedRef.current) {
          if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
          setEndingSoon(false);
    setEndsAt(0);
          acc.endOfTurn = { state: "complete", reason: "candidate_declined", trigger: act.matchedTrigger };
          endedRef.current = true;
          actRef.current?.({ act: "decline", text: acc.finalText });
          return;
        }

        // "Give me a second." Purely patience: say so out loud, buy a much longer window, and
        // stay out of the way. It ends nothing and is never submitted anywhere — the phrase rides
        // along with the eventual answer as a recorded condition of the interview.
        if (act.honour && act.act === "pause" && policy.pauseReplies.length && !endedRef.current) {
          if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
          setEndingSoon(false);
    setEndsAt(0);
          void (async () => {
            const phrase = policy.pauseReplies[turnCounterRef.current % policy.pauseReplies.length];
            await playBackchannel(phrase);
            bcEventsRef.current.push({ kind: "pause", phrase, at: Date.now() });
            if (endedRef.current || !sessionRef.current) return;
            pausedUntilRef.current = Date.now() + policy.acts.pauseGraceMs;
            armSilence(policy.acts.pauseGraceMs);
          })();
          return;
        }

        // "That's my answer." The fastest end-of-turn signal there is, and the pipeline used to
        // ignore it entirely — a candidate who said they were done then sat through a timer they
        // could not see. Honoured only as the tail of a substantive answer (see finishIntent.js),
        // and it ends the turn outright: no reassurance, no "anything to add?", no countdown.
        // They already answered that question.
        if (policy.finishTriggers.length && !endedRef.current) {
          const fin = detectFinish(acc.finalText, {
            triggers: policy.finishTriggers,
            minAnswerWords: policy.finishMinAnswerWords,
            maxTrailingWords: policy.finishMaxTrailingWords,
          });
          if (fin.honour) {
            acc.endOfTurn = { state: "complete", reason: "candidate_said_finished", trigger: fin.matchedTrigger };
            if (graceTimerRef.current) {
              clearTimeout(graceTimerRef.current);
              graceTimerRef.current = null;
            }
            endedRef.current = true;
            autoEndRef.current?.();
            return;
          }
        }

        // "Sorry, could you repeat that?" — checked on FINAL transcripts only, never interim: a
        // partial can be revised, and acting on one risks discarding an answer that was never a
        // request. Only honoured while the candidate has said nothing substantive yet; past that
        // they are mid-answer and we leave their words alone.
        if (
          policy.maxRepeatsPerQuestion > 0 &&
          repeatsRef.current < policy.maxRepeatsPerQuestion &&
          !repeatBusyRef.current &&
          !endedRef.current
        ) {
          const hit = detectRepeat(acc.finalText, policy.repeatTriggers);
          if (hit.matched && hit.remainderWords <= policy.repeatMaxCarryWords) {
            // The request itself must not become part of the answer — keep only what wasn't it.
            acc.finalText = hit.remainder;
            setInterim(hit.remainder);
            repeatsRef.current += 1;
            if (graceTimerRef.current) {
              clearTimeout(graceTimerRef.current);
              graceTimerRef.current = null;
            }
            setEndingSoon(false);
    setEndsAt(0);
            void (async () => {
              await repeatQuestionRef.current?.();
              if (endedRef.current || !sessionRef.current) return;
              // Back to a fresh listening window, as if the question had just been asked.
              armSilence(policyRef.current.initialSilenceMs);
            })();
            return;
          }
        }

        // ---- Nothing above recognised it. Ask what it meant. ----
        //
        // Everything before this point is a stated rule matching a stated phrase. This is the tail
        // those rules were never going to cover: "I didn't follow that last bit", "in what sense?",
        // "sorry, how many more of these are there?". Reaching here is the normal case for an
        // ordinary answer, so the gates below matter — they decide when it is worth asking.
        if (policy.intent.semanticEnabled && !endedRef.current && !bcBusyRef.current) {
          const utterance = t.trim();
          // Worth a lookup whenever the UTTERANCE is short enough to carry a request. It used to
          // also require that the candidate had said little so far this turn — which meant
          // "actually, you know what, could we skip this one?" said forty words into an answer was
          // never even looked up, and the interviewer transcribed the request as part of the
          // answer and carried on. A short interjection mid-answer is MORE likely to be a request,
          // not less: someone who has been talking for a while and then says six words has
          // usually stopped answering and started asking.
          //
          // `askSemanticIntent` applies the length bounds itself, and the server re-checks every
          // one of them before acting, so there is nothing left for this site to gate on.
          {
            void (async () => {
              const result = await askSemanticIntentRef.current?.(utterance, beforeThisFinal);
              if (!result || result.action === "answer_continues") return;
              // The turn moved on while we were asking. Acting now would apply a reading of an old
              // utterance to a turn that has already changed — so it is dropped, and the candidate
              // simply has an unremarked-on moment rather than a mystifying one.
              if (endedRef.current || sessionRef.current !== acc) return;
              if (acc.finalText !== `${beforeThisFinal} ${t}`.trim()) return;

              // It was about the interview, so it is not part of the answer. What they said that
              // WASN'T the request is kept (server-verified as literally theirs).
              if (result.consumesTurn) {
                acc.finalText = `${beforeThisFinal} ${result.residue || ""}`.trim();
                setInterim(acc.finalText);
              }
              if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
              setEndingSoon(false);
    setEndsAt(0);

              switch (result.action) {
                // They didn't hear it. Same audio, same words — see repeatQuestion.
                case "repeat":
                  repeatsRef.current += 1;
                  await repeatQuestionRef.current?.();
                  break;
                // They heard it and didn't understand it. Same authored question, different
                // framing — because replaying an identical sentence to someone who already heard
                // it is the single most machine-like thing an interviewer can do.
                case "clarify":
                  repeatsRef.current += 1;
                  await repeatQuestionRef.current?.({ preambles: policy.clarifyPreambles, restate: true });
                  break;
                // A question about the interview, answered from this session's real state. The
                // sentence is the server's, already written into the transcript as a turn.
                case "meta_question":
                  await speakServerTextRef.current?.(result.speak);
                  break;
                case "technical_problem":
                  if (policy.technicalReplies.length) {
                    const phrase = policy.technicalReplies[0];
                    await playBackchannel(phrase);
                    bcEventsRef.current.push({ kind: "technical", phrase, at: Date.now() });
                  }
                  break;
                case "pause":
                  if (policy.pauseReplies.length) {
                    const phrase = policy.pauseReplies[turnCounterRef.current % policy.pauseReplies.length];
                    await playBackchannel(phrase);
                    bcEventsRef.current.push({ kind: "pause", phrase, at: Date.now() });
                  }
                  if (endedRef.current || sessionRef.current !== acc) return;
                  pausedUntilRef.current = Date.now() + policy.acts.pauseGraceMs;
                  armSilence(policy.acts.pauseGraceMs);
                  return;
                case "decline":
                  endedRef.current = true;
                  acc.endOfTurn = { state: "complete", reason: "candidate_declined", trigger: null };
                  actRef.current?.({ act: "decline", text: acc.finalText });
                  return;
                // "That's my answer", in one of the hundred ways nobody put on a trigger list.
                // Their words ARE the answer here (consumesTurn is false for this action), so
                // nothing is stripped — the turn simply ends now instead of after a silence.
                case "finished":
                  acc.endOfTurn = { state: "complete", reason: "candidate_said_finished", trigger: null };
                  endedRef.current = true;
                  autoEndRef.current?.();
                  return;
                // Understood perfectly and STILL confirmed before anything happens. The asymmetry
                // is the reason: continuing someone who wanted to stop costs them one question
                // they can decline; stopping someone who did not costs them the job.
                case "withdraw": {
                  if (!policy.withdrawConfirmations.length) return;
                  withdrawRef.current = { requestText: utterance, priorText: acc.finalText, timer: null };
                  const phrase = policy.withdrawConfirmations[0];
                  await playBackchannel(phrase);
                  bcEventsRef.current.push({ kind: "withdraw_confirm", phrase, at: Date.now() });
                  if (endedRef.current || sessionRef.current !== acc || !withdrawRef.current) return;
                  withdrawRef.current.timer = setTimeout(() => {
                    const stale = withdrawRef.current;
                    withdrawRef.current = null;
                    if (endedRef.current || sessionRef.current !== acc) return;
                    acc.finalText = stale?.priorText ?? acc.finalText;
                    setInterim(acc.finalText);
                    armSilence(policy.initialSilenceMs);
                  }, policy.acts.withdrawConfirmGraceMs);
                  return;
                }
                default:
                  return;
              }

              if (endedRef.current || sessionRef.current !== acc) return;
              // Whatever we just said, hand the floor back with a fresh listening window — as if
              // the question had only now been asked.
              armSilence(policyRef.current.initialSilenceMs);
            })();
          }
        }
      } else {
        acc.lastInterim = t;
        setInterim(`${acc.finalText} ${t}`.trim());

        // Start the semantic lookup NOW, while they are still finishing the sentence, so the
        // answer is usually already here when the final arrives. Without this the tier added a
        // visible beat of silence to exactly the moments it exists to handle: the candidate asks
        // something unusual, stops, and the interviewer does nothing at all for a second.
        //
        // Nothing is ACTED on here — an interim can still be revised, and acting on one risks
        // discarding an answer that was never a request. This only warms the cache; the final
        // transcript is what decides, and a prefetch it does not match is simply never read.
        if (policyRef.current.intent.semanticEnabled && !endedRef.current && !bcBusyRef.current) {
          void askSemanticIntentRef.current?.(t.trim(), acc.finalText);
        }
      }
    };
    // Open a transcription socket and start feeding it. Called once when the turn begins, and
    // again by the drop handler below — which is the whole reason it is a function.
    const connect = async (accessToken) => {
      const ws = new WebSocket(url, ["bearer", accessToken]);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = handleMessage;
      // `onerror` always fires immediately before `onclose`, so recovery is handled in one place
      // (below) rather than twice. This only records that something went wrong.
      ws.onerror = () => {};
      ws.onclose = () => {
        // Ours, superseded by a newer socket, or the turn is already over — nothing to recover.
        if (deliberateCloseRef.current) return;
        if (wsRef.current !== ws) return;
        // "The turn is over" is no longer a reason to ignore a drop. The socket belongs to the
        // SESSION now, so a pipe that dies between questions still has to come back before the
        // next one — otherwise the persistent session would quietly become a dead one.
        void handleDrop();
      };

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
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, 8000);
      setConnection("live");
    };

    // The socket died underneath a live answer. Stop pretending to listen, try once to get it
    // back, and if that fails say so out loud — the one thing that must never happen here is
    // carrying on quietly and submitting whatever happened to arrive before the pipe went down.
    const handleDrop = async () => {
      if (reconnectingRef.current) return;
      reconnectingRef.current = true;
      const droppedAt = Date.now();
      // Whichever turn is live right now — or none, between questions. A drop in the gap still
      // has to be recovered, but there is no answer to charge it to and none to corrupt.
      const acc = sessionRef.current;
      if (acc) acc.drops += 1;
      setConnection("reconnecting");

      // Nothing may end this turn while we are deaf. An auto-submit here would ship the
      // truncated transcript, which is precisely the failure being fixed.
      if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
      setEndingSoon(false);
    setEndsAt(0);
      // Stop feeding a dead pipe. The MICROPHONE STREAM stays open — only the socket died, and
      // re-prompting for permission mid-answer would be its own failure.
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      } catch { /* ignore */ }
      recorderRef.current = null;
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;

      try {
        // A fresh credential, not the old one: the original grant is short-lived and is very
        // likely to be the reason the socket closed in the first place.
        const { data: fresh } = await api.get("/interview-portal/voice/token", { headers: authHeader() });
        await connect(fresh.accessToken);
        if (!acc || endedRef.current || sessionRef.current !== acc) return;
        acc.gapMs += Date.now() - droppedAt;
        setError("");
        // Hand the floor back with a fresh window. The candidate kept talking through the gap
        // and does not know it happened yet; ending their turn on a stale timer now would be
        // indistinguishable from cutting them off.
        armSilence(policyRef.current.initialSilenceMs);
      } catch {
        setConnection("lost");
        // A failed reconnect BETWEEN questions is not the same event as one mid-answer, and
        // treating it as one was a bug this refactor introduced: before the session persisted,
        // the socket was closed deliberately between turns and this path could not run there at
        // all. Setting `phase` to "disconnected" in the gap froze the interview outright — the
        // room only asks the next question from "idle", and the watchdog only fires from "idle"
        // either, so there was no way back. And the wording was wrong too: there is no answer to
        // give again, because they already gave it.
        //
        // Nothing is lost here, so nothing needs saying. `openMic` rebuilds the whole session
        // from scratch when the next question arrives, because its fast path requires an OPEN
        // socket and this one is not.
        if (!acc) return;
        acc.gapMs += Date.now() - droppedAt;
        acc.lost = true;
        setPhase("disconnected");
        setError(
          "The connection to the voice service dropped and couldn't be restored. Anything you said " +
            "in the last few seconds wasn't recorded — you can answer this question again, or switch to typing."
        );
      } finally {
        reconnectingRef.current = false;
      }
    };

    deliberateCloseRef.current = false;
    await connect(cred.accessToken);
    // The session is up. `beginTurn` starts the answer and arms the clock — the same call the
    // fast path above makes, so the first question and every one after it behave identically.
    //
    // (The clock exists because UtteranceEnd only fires AFTER speech: a candidate who has not
    // started saying anything would otherwise sit in silence with an open mic and no
    // acknowledgement they exist.)
    beginTurn();
  }, [supported, stopSpeaking, primeBackchannels, armSilence]);

  // Ask the question and then listen — the single entry point the interview room uses.
  //
  // The microphone now opens FIRST on every path, before a word of the question is spoken, and
  // stays open through it. Being able to cut in mid-sentence is ordinary human behaviour, and
  // being unable to is one of the things that makes an AI interview feel like a form.
  //
  // This used to be conditional on the pre-check measuring that the device's microphone could not
  // hear its own speakers, because otherwise the interviewer heard itself start talking and
  // stopped mid-question, every question. That is now handled by comparing what we hear against
  // what we are saying (portal/echoAlignment.js) rather than by hoping for good hardware — so
  // candidates on laptop speakers get the same interviewer as candidates in headphones.
  //
  // `VOICE_FULL_DUPLEX=false` on the server still restores the old shape exactly: the socket opens
  // early either way (so nothing said at the very start of a turn is lost), but capture is paused
  // for the duration of the question, which is the pre-echo-gate protection.
  const askAndListen = useCallback(
    async (text, { bargeIn = false, bridges = false, restatement = "" } = {}) => {
      deliveryRef.current = { deliveredFully: true, interruptedAtChar: null };
      await openMic({ armTurnClock: false });

      // A recruiter-approved question owes nothing to the answer just given, so without this it
      // arrives as an abrupt gear-change — and because the interview alternates approved question
      // / adaptive follow-up, that happens every other turn. One approved sentence signalling a
      // change of subject is what a human would say, costs a second, and characterises nothing
      // about the previous answer. The server decides WHICH questions bridge; this only plays it.
      const bridgeBank = policyRef.current.bridges;
      if (bridges && bridgeBank.length) {
        const phrase = bridgeBank[turnCounterRef.current % bridgeBank.length];
        await playBackchannel(phrase);
        bcEventsRef.current.push({ kind: "bridge", phrase, at: Date.now() });
      }

      // `bargeIn` is the caller's measured-isolation signal. It is now an OR rather than the sole
      // gate: a device that measured clean is interruptible even if the echo gate were disabled.
      const duplex = policyRef.current.echo.fullDuplex || bargeIn;
      if (!duplex) {
        setPhase("speaking");
        const rec = recorderRef.current;
        try {
          if (rec && rec.state === "recording") rec.pause();
        } catch { /* ignore */ }
        try {
          await speak(text, { restatement });
        } finally {
          try {
            if (recorderRef.current && recorderRef.current.state === "paused") recorderRef.current.resume();
          } catch { /* ignore */ }
        }
        setPhase("listening");
        armSilence(policyRef.current.initialSilenceMs);
        return;
      }

      setPhase("speaking");
      onBargeInRef.current = () => {
        const audio = audioRef.current;
        // Where in the question they cut in, estimated from playback position. Approximate on
        // purpose — it exists to answer "did they actually hear the question?", not to be exact.
        if (audio && audio.duration > 0) {
          const fraction = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
          deliveryRef.current = {
            deliveredFully: false,
            interruptedAtChar: Math.round(String(text || "").length * fraction),
          };
        } else {
          deliveryRef.current = { deliveredFully: false, interruptedAtChar: 0 };
        }
        stopSpeaking();
      };
      bargeInArmedRef.current = true;
      try {
        await speak(text, { restatement });
      } finally {
        bargeInArmedRef.current = false;
        onBargeInRef.current = null;
      }
      setPhase("listening");
      armSilence(policyRef.current.initialSilenceMs);
    },
    [speak, openMic, armSilence, stopSpeaking, playBackchannel]
  );

  // "I'm still thinking." — cancel the pending end of turn and hand the floor straight back.
  //
  // Speaking again already does this (the socket handler clears the timer on the next transcript),
  // but that is only useful to a candidate who has words ready. The one who needs it most is the
  // one who has NOT: they can see the countdown, they know they are not finished, and they have
  // nothing to say yet. Without a control their only options are to make a noise or lose the turn.
  //
  // It grants the same window the interviewer grants when it says "take your time", and it is
  // recorded like every other condition of the interview — never as a signal about the candidate.
  const keepListening = useCallback(() => {
    if (endedRef.current || !sessionRef.current) return;
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    setEndingSoon(false);
    setEndsAt(0);
    const policy = policyRef.current;
    sessionRef.current.keepListeningCount = (sessionRef.current.keepListeningCount || 0) + 1;
    armSilence(policy.postReassuranceGraceMs, "holding");
  }, [armSilence]);

  // Kept for callers that manage speaking themselves (and for re-opening the mic after a failed
  // transcription without re-asking the question).
  const startListening = useCallback(() => openMic({ armTurnClock: true }), [openMic]);

  // Finish the current answer: flush Deepgram, tear down, and return the transcript + metadata.
  const finishListening = useCallback(async () => {
    const acc = sessionRef.current;
    const backchannels = bcEventsRef.current;
    bcEventsRef.current = [];
    setPhase("processing");
    // `Finalize`, not `CloseStream`. Both flush whatever audio the provider is still holding, but
    // CloseStream ends the socket — which is what used to make the microphone dead for the whole
    // gap between questions, and what made every question pay for a fresh handshake. Finalize
    // gets the trailing words and leaves the pipe up.
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "Finalize" }));
      }
    } catch { /* ignore */ }
    // A beat for the flushed final to arrive. Shorter than the old 450ms because nothing is being
    // torn down behind it — this is waiting for one message, not for a socket to drain and close.
    await new Promise((r) => setTimeout(r, 250));
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
      speakers: summarizeSpeakers(acc.speakerWords),
      // Reported on submit so the server can strip any of our own words that the mic picked up,
      // and record the interview's real conversational conditions.
      backchannels,
      // A condition of the interview, not a signal about the candidate — the server records it on
      // the question turn and no scorer ever reads it.
      repeatCount: repeatsRef.current,
      // Why this turn ended: the endpointing verdict, or that the candidate said so outright.
      // Recorded so "it cut me off" is answerable from the session rather than from memory.
      // Never a scoring input — how someone paces their speech is not a measure of competence.
      endOfTurn: acc?.endOfTurn || { state: "manual", reason: "candidate_pressed_done" },
      // Whether the question was actually finished before the candidate started answering. The
      // server uses this to decide whether the question really covered its claim-probe.
      questionDelivery: { ...deliveryRef.current },
      // What the connection did while this answer was being recorded. `lost` means the caller
      // must NOT submit this as a complete answer — words are missing and we know it. Even a
      // recovered drop travels with the transcript, because "we reconnected" is not "we heard
      // everything", and the report has to be able to tell a reviewer which one happened.
      connection: {
        drops: acc?.drops || 0,
        gapMs: acc?.gapMs || 0,
        lost: Boolean(acc?.lost),
      },
      // What they said in the gap before this question was asked — captured because the
      // microphone no longer closes between turns. Recorded as a condition of the interview, and
      // deliberately not spliced into any answer: it followed the PREVIOUS one.
      spokeBetweenTurns: acc?.spokeBetweenTurns || "",
    };
  }, [cleanupAnswer]);

  const cancelListening = useCallback(() => {
    // A full teardown, not just the turn: this is the candidate leaving voice mode, and leaving
    // the microphone live after they switched to typing would be indefensible.
    teardownSession();
    bcEventsRef.current = [];
    setInterim("");
    setPhase("idle");
  }, [teardownSession]);

  // Tear everything down on unmount.
  useEffect(() => {
    const cache = bcCacheRef.current;
    return () => {
      stopSpeaking();
      teardownSessionRef.current?.();
      // Release the pre-synthesized backchannel audio held for the whole session, and the current
      // question's audio (held so a repeat can replay the same bytes).
      for (const pending of cache.values()) {
        Promise.resolve(pending).then((url) => { if (url) URL.revokeObjectURL(url); }).catch(() => {});
      }
      cache.clear();
      // The question's URL is a server stream now, not a blob — there is nothing local to release
      // unless an older code path put one there.
      if (questionAudioRef.current?.startsWith("blob:")) URL.revokeObjectURL(questionAudioRef.current);
      questionAudioRef.current = null;
    };
  }, [stopSpeaking, cleanupAnswer]);

  return {
    supported,
    phase,
    interim,
    error,
    endingSoon,
    backchannel,
    personaName,
    canInterrupt,
    // "idle" | "live" | "reconnecting" | "lost". The room shows this, because a candidate who
    // is talking into a socket that just died has a right to know before they finish the answer.
    connection,
    // Epoch ms at which the turn will end, or 0. Drives the visible countdown.
    endsAt,
    // The candidate is talking in the gap between questions. The room holds the next question
    // until they stop, which is the entire reason the microphone now stays open through that gap:
    // asking the next question over someone who is still adding to their last answer is exactly
    // the thing that made this feel like a form.
    speakingBetweenTurns,
    keepListening,
    speak,
    askAndListen,
    acknowledge,
    acknowledgeDecline,
    stopSpeaking,
    startListening,
    finishListening,
    cancelListening,
  };
}
