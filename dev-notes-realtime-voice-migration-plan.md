# Dev Notes: Path to Real-Time (Speech-to-Speech) Voice Interviews

**Date:** 2026-07-22
**Project:** recruitment (backend + user)
**Status:** Future plan — not started. Nothing in this doc has been implemented.
**Prepared for:** Developer handoff / future planning session

---

## 1. Summary

Today's voice interview is **turn-based**, not full-duplex real-time:

```
Browser mic → Deepgram STT (streaming, direct browser→Deepgram) → transcript
  → backend (aiInterviewService: plan / next question / score)
  → backend → Deepgram TTS (server-proxied, full-buffer) → MP3 → browser plays
```

Each answer is: record → transcribe → wait → get next question → wait → hear it. No barge-in
(candidate can't interrupt), no simultaneous listen/speak, and each leg adds latency.

A **speech-to-speech** model (OpenAI Realtime, Amazon Nova Sonic, Google Gemini Live, etc.)
collapses STT+dialogue+TTS into one persistent low-latency session with natural turn-taking
and interruption handling — closer to a real phone/video call.

This doc is the plan for *if/when* we do that swap. See [[voice-interview-priority]] and
`backend/services/speechService.js` header comments for the residency context this plan must
respect.

---

## 2. Decision gate: residency, before anything else

[[voice-interview-priority]] already commits us to keeping candidate voice **in India** (DPDP),
with a planned swap to self-hosted Whisper / Sarvam AI. **This is the first filter on any
speech-to-speech vendor, not a nice-to-have** — evaluate it before comparing latency or pricing:

| Provider | Speech-to-speech offering | Known hosting | Residency fit (verify before committing) |
|---|---|---|---|
| Sarvam AI | India-focused STT/TTS/LLM stack | India | Best starting point — already the planned residency-safe swap target |
| Amazon Nova Sonic (Bedrock) | Bidirectional streaming speech-to-speech | Region-selectable on Bedrock | Check whether Nova Sonic is actually offered in an India (ap-south-1/ap-south-2) Bedrock region — availability varies by model, don't assume |
| OpenAI Realtime API (gpt-realtime) | WebRTC/WebSocket speech-to-speech | US/global, no India data residency option as of this writing | Likely disqualified unless OpenAI adds an India region |
| Google Gemini Live API | Streaming speech-to-speech | Google Cloud, region-selectable per product | Check `asia-south1` (Mumbai) availability for the specific Live API, not just Gemini text models |
| Deepgram (current vendor) | Check for a "Voice Agent" / speech-to-speech product (separate from today's STT+TTS pair) | Confirm hosting region | Worth checking first since we already have a Deepgram relationship + API key |

**Action before any implementation work:** get written confirmation (docs or vendor contact) of
where raw audio is processed/stored for whichever provider looks best, and re-confirm this is
still a DPDP requirement (compliance may have refined the constraint by the time this is picked
up).

---

## 3. Target architecture (once a provider passes the residency gate)

### 3.1 Session lifecycle

- Add a new endpoint, e.g. `POST /api/interview-portal/voice/realtime-session`, mirroring the
  existing `grantStreamingToken` pattern in `speechService.js` — mints a short-lived credential
  server-side (key never reaches the browser) and returns session config.
- Browser opens a WebSocket/WebRTC connection directly to the provider (same "raw audio never
  transits our server" principle as today's STT), authenticated with that short-lived token.

### 3.2 Bridging the adaptive interview logic

This is the hard part. Today, `aiInterviewService.js` drives the interview turn-by-turn: it
calls the LLM (OpenRouter) between answers to plan, pick the next question, adapt difficulty,
and score — all in text, off the audio path entirely. A speech-to-speech session collapses
listening+responding into one loop, so that per-turn control point has to be re-created:

- **Option A — steer via injected turns.** Keep `aiInterviewService.js`'s planning/question logic
  as-is (still text, still OpenRouter). After each candidate turn, the backend receives the
  transcript from the speech-to-speech session (most providers emit one), runs the existing
  `nextQuestion()` logic, then injects the chosen question back into the live session as an
  assistant turn for the provider to speak (e.g. OpenAI Realtime's `conversation.item.create` +
  response trigger). Keeps today's adaptive-difficulty/scoring code untouched; the swap is
  mostly at the transport layer.
- **Option B — hand the whole interview to the provider.** Give the speech-to-speech model a
  system prompt with the full interview plan/topics up front and let it run the conversation
  autonomously, using tool-calling to report structured turns back to the backend for storage.
  Simpler transport, but loses today's per-turn adaptive logic (difficulty ramp, budget-aware
  fallback-to-deterministic-questions) unless it's rebuilt as tool definitions for the provider.

**Recommendation when this is picked up: start with Option A.** It's a narrower change (new
transport + a bridge, not a rewrite of the interview engine) and preserves the deterministic
fallback guarantee already in place (`useAi` gate, budget check, consent check in
`aiInterviewService.js`) — a speech-to-speech outage or over-budget tenant can still fall back to
the current turn-based pipeline instead of being blocked entirely.

### 3.3 Fallback and rollout safety

- Gate per-tenant via `CompanySettings.ai` (already has a per-tenant `model`/config block) — add
  e.g. `ai.voiceMode: "turn_based" | "realtime"`, default `turn_based`. Never a global flip.
  Same "fail open to fallback, never block the interview" posture as `useAi` today.
- Keep the current turn-based pipeline as the fallback path if a realtime session fails to
  connect or drops mid-interview — the candidate should never be stuck because a WebSocket
  reset (exactly the class of bug fixed 2026-07-22, see below).
- **Apply the same hardening this session added for the current pipeline**: any new realtime
  client code needs `res`/socket `'error'` listeners and must go through `asyncHandler` (or the
  WS-equivalent — catch and log, never let a dropped session throw uncaught). A live speech-to-
  speech WebSocket is *more* exposed to mid-session resets than today's short discrete HTTP
  calls, not less — this is more important with realtime, not optional.

---

## 4. Rough phase plan (effort is a guess — re-estimate when picked up)

1. **Vendor + residency confirmation** (section 2) — do not skip or assume; get it in writing.
2. **Spike**: one throwaway script that opens a realtime session, streams a canned question,
   and gets a spoken response + transcript back. Validates latency and transcript quality before
   touching production code.
3. **Backend**: new token-mint endpoint + Option A bridge (inject `nextQuestion()` output into
   the live session; capture transcripts back into `session.aiInterview.turns` unchanged).
4. **Frontend (`user/`)**: replace the current record→POST /voice/speak→play loop with a
   persistent WS/WebRTC connection component; keep the existing UI states (listening/thinking/
   speaking) since the mental model doesn't change, only the transport underneath it.
5. **Tenant-flagged rollout**: ship behind `CompanySettings.ai.voiceMode`, dogfood on one
   internal/test company first.
6. **Cost check**: speech-to-speech providers are typically billed by session-minute and cost
   meaningfully more than discrete STT+text-LLM+TTS calls — extend `usageService`'s metering
   (already meters every LLM call in `aiInterviewService.js`) to cover realtime session minutes
   before enabling for a paying tenant.

---

## 5. When to actually revisit this

Not proactively — the turn-based pipeline is a reasonable tradeoff today. Revisit when there's a
concrete signal, e.g.:

- Candidate feedback or drop-off data shows the record→wait→respond cadence is hurting completion
  rates.
- A residency-compliant provider (Sarvam AI or a confirmed India-region Nova Sonic/Gemini Live)
  is confirmed available, lowering the compliance risk of even spiking this.
- The self-hosted Whisper/Sarvam AI STT swap (already planned, see [[voice-interview-priority]])
  happens anyway — if Sarvam AI is in the stack for STT, check whether their speech-to-speech
  product is a natural extension at that point rather than a separate vendor evaluation.

---

## 6. Context: the crash this session fixed (why the "don't let it crash" note above matters)

On 2026-07-22 the backend crashed mid-interview: Deepgram reset a connection mid-response
(`socket hang up`), and that error had no safe path — `speechService.js` only guarded the
outgoing request, not the response stream, and the Express 4 route handlers had no
promise-rejection-to-`next(err)` forwarding, so the rejection became an unhandled rejection and
crashed the whole process (Node's default behavior since v15), taking down every candidate's live
interview, not just the failing request.

Fixed by: `res.on("error", reject)` in `speechService.js`'s two request helpers, a new
`backend/middleware/asyncHandler.js` wrapping every route in `interviewPortalRoutes.js`, and a
last-resort `process.on("unhandledRejection"/"uncaughtException")` log-and-continue net in
`server.js`. The same `asyncHandler`-less gap likely still exists in the other ~15 route files —
not yet swept, flagged for a future pass.
