# LIVEKIT REALTIME PLAN — self-orchestrated voice interviews

> The sequenced plan for moving the realtime voice interview from the bundled Deepgram Voice Agent
> to a self-orchestrated LiveKit pipeline, and how to deploy it.
> Companion docs: [CLAUDE.md](CLAUDE.md) (product thesis + engineering rules — **read first**),
> [AI-INTERVIEW-PIPELINE.md](AI-INTERVIEW-PIPELINE.md) (how the current turn-based and Deepgram-Agent
> realtime pipelines work, incl. the 14 worked scenarios), [BUILD-PLAN.md](BUILD-PLAN.md) (phase
> format this document follows), [DEPLOY.md](DEPLOY.md) (Render/Vercel production layout).
>
> _Created 2026-08-04. Nothing in this document is built yet. The Deepgram Voice Agent path
> (`VOICE_MODE=realtime`) and the turn-based path remain the shipped reference implementations and
> are NOT removed by this plan — this is a third pipeline, added behind the same flag pattern._
>
> _**Update 2026-08-06:** LK-0..LK-4 are built and live-verified (see [STATUS.md](STATUS.md) §E),
> and the owner has since decided to **remove the Deepgram Voice Agent pipeline** — the platform
> now runs exactly two: `turn_based` (the permanent floor) and `livekit`. Where this document says
> "three pipelines" or describes `voiceMode: "realtime"`, read it as history. The current operator
> reference is [VOICE-PIPELINE-GUIDE.md](VOICE-PIPELINE-GUIDE.md)._

---

## 0. Why this migration, in one paragraph

The Deepgram Voice Agent path works but costs ~$0.075/min bundled (~$1.50 per 20-minute interview),
relays the OpenRouter key through the candidate's browser inside the Settings block (flagged in
`backend/routes/voiceAgentRoutes.js` as the most sensitive endpoint on the portal), and depends on
the candidate's browser to relay transcripts for the guardrail and evidence chain. Self-orchestrating
on LiveKit cuts cost to ~$0.02–0.05/min all-in (~$0.40–1.00 per interview), keeps every API key
server-side, captures the evidence chain in our own media path, runs the guardrail inline instead of
browser-debounced, gives us WebRTC reconnect on bad mobile networks (a documented gap), and opens the
self-hosted DPDP data-residency path (LiveKit server is open source; host it in an Indian region).

## 1. Differentiation check (mandatory, per CLAUDE.md)

**What does everyone else do?** Rent a hosted voice-agent platform (Vapi, Retell, Bland) or a bundled
speech-to-speech API (Deepgram Voice Agent, OpenAI Realtime), prompt an LLM to "be an interviewer",
and let it improvise both the questions and the judgement inside vendor infrastructure at
$0.08–0.33/min.

**Why is that weak?** Unauditable (no verbatim question fidelity — you cannot prove what was asked),
non-reproducible (the model owns the conversation), expensive at volume, the evidence chain runs
through a vendor black box, keys and candidate audio transit third-party orchestration, and there is
no data-residency story for DPDP.

**What do we do instead, and what value does a buyer feel?** A **transport swap, not a brain swap**.
Our engine (`aiInterviewService`) remains the sole question author and scorer; the guardrail, dialogue
acts, evidence chain, probes, and report pipeline do not move. The LiveKit worker is the same "mouth
and ears" role the Deepgram agent plays today — its only powers are the same three functions
(`get_next_question`, `submit_answer`, `end_interview`). What the buyer feels: the same auditable
interview at roughly one third the cost, with keys that never leave our servers, transcripts captured
server-side (a *stronger* evidence chain than today — the candidate's browser can no longer be a
tamper point), and a credible "your candidates' audio can stay in India" answer that no hosted agent
platform offers.

## 2. Framework decision — LiveKit, not Pipecat, and Python, not Node

| Decision | Choice | Why |
|---|---|---|
| Framework | **LiveKit Agents** | WebRTC-native transport (auto-reconnect, jitter buffering — solves our documented reconnect gap that a WebSocket audio stream cannot); ships an open-source semantic turn-detection model; the LiveKit server itself is OSS → self-host path for DPDP residency. Pipecat is excellent but Python-only with a weaker self-host story. They are alternatives — you pick one. |
| Worker language | **Python** (`livekit-agents`) | The Node SDK (`@livekit/agents`) is in beta with an explicit "APIs may change" notice; the Python SDK is the mature one (1.5 shipped the audio-based interruption model, April 2026). The worker is thin — roughly the size of `voiceAgentService.js` — and calls our existing Node endpoints for everything that matters. Revisit Node when agents-js goes stable. |
| Hosting (first) | **LiveKit Cloud** (Build free tier → Ship $50/mo) | Zero SFU ops while we prove parity. Self-hosting is Phase LK-6, not Phase LK-0. |
| STT | **Deepgram Flux** via the livekit-agents Deepgram plugin | Same vendor as turn-based → keyterms (`asrVocabularyService`) port unchanged; Flux is the same end-of-turn model the Voice Agent API uses internally. |
| TTS | **Deepgram Aura** (same `DEEPGRAM_TTS_MODEL` voice) | Voice parity — the candidate hears the same interviewer regardless of pipeline. |
| LLM | **OpenRouter** via the OpenAI-compatible plugin (`base_url` override) | Same `OPENROUTER_API_KEY`, same model registry semantics. `VOICE_AGENT_THINK_PROVIDER` overrides carry over conceptually (point the plugin at Groq etc. for latency). |
| Turn detection | LiveKit semantic turn-detector model + Silero VAD | Replaces both Deepgram's bundled orchestration and our hand-rolled `endpointing.js` heuristics — this is the component that makes it feel human. |

## 3. Target architecture

```
Candidate browser                LiveKit Cloud (SFU)              agent-worker (Python)         backend (Node, :9000)
─────────────────                ───────────────────              ─────────────────────         ─────────────────────
livekit-client SDK  ◄──WebRTC──► room: itv-{sessionId} ◄──────► livekit-agents session
  mic + playback                                                   ├─ Deepgram Flux STT
  captions (transcription                                          ├─ OpenRouter LLM (renderer only)
    events from worker)                                            ├─ Deepgram Aura TTS
  NO API keys, NO Settings                                         ├─ turn detector + Silero VAD
  block, NO transcript relay                                       └─ function tools ──HTTP──►  /api/interview-portal/realtime/function
                                                                       (portal JWT from            (get_next_question / submit_answer /
                                                                        dispatch metadata)          end_interview — EXISTING endpoint)
                                          room_finished                                        ►  /api/interview-portal/realtime/transcript
                                          webhook ────────────────────────────────────────────►     (guardrail scan — EXISTING endpoint)
                                                                                               ►  /api/webhooks/livekit  (NEW — authoritative
                                                                                                    metering, replaces sendBeacon trust)
```

The load-bearing property: **the worker reuses the existing `/realtime/function` and
`/realtime/transcript` endpoints with the candidate's own portal JWT**, handed to it server-side via
agent-dispatch metadata (never through the room, never to the browser). The engine cannot tell the
difference between the Deepgram agent and the LiveKit worker — same contract, same `sanitizeEvidence`
clamps, same guardrail, same dialogue-act re-detection, same `verifyQuestionsAsked` fidelity check at
finalization. That is what "features not hindered" means mechanically.

Pipeline mutual exclusion in `InterviewRoom.jsx` extends the existing pattern — exactly one is true:

```js
const livekitMode  = mode === "voice" && supported && livekit.available === true;
const realtimeMode = mode === "voice" && supported && !livekitMode && realtime.available === true;
const voiceMode    = mode === "voice" && supported && !livekitMode && !realtimeMode;
```

`GET /realtime/available` grows a `pipeline: "livekit" | "deepgram_agent" | "none"` field resolved
from `CompanySettings.ai.voiceMode` → `VOICE_MODE` env, so the room asks once and runs one pipeline.

## 4. Multi-tenancy — how one pipeline serves many companies

**The worker is stateless and tenant-blind.** Every job arrives with dispatch metadata
`{sessionId, portalToken, backendUrl}`; everything tenant-specific — rubric-derived questions,
persona voice, keyterms, agent prompt, guardrail policy, budget — is resolved **per tenant by the
backend** when it assembles the session brief, exactly the way one Express API already serves every
tenant. One LiveKit project and one worker fleet serve all companies; adding a tenant is a
CompanySettings flip, never an infra change.

| Shared (platform-level) | Per-tenant (resolved at session mint) |
|---|---|
| LiveKit Cloud project + keys | Enablement: `CompanySettings.ai.voiceMode = "livekit"` (overrides `VOICE_MODE` both directions, as today) |
| Worker fleet (each instance handles many concurrent sessions, any tenant) | Persona voice, agent prompt, keyterms (`asrVocabularyService` per role/company) |
| Deepgram / OpenRouter platform keys | Budget gate (`usageService.isOverBudget` per company) |
| Metering webhook | Cost attribution: every `UsageEvent` carries the companyId — the platform LiveKit invoice is allocated per tenant from our own metering |
| | **Concurrent-interview quota per plan tier** (added in LK-1 — see below) |
| | (LK-6) `LIVEKIT_URL` per tenant: residency-pinned tenants → self-hosted Indian-region server, everyone else → Cloud. The session mint picks the endpoint; nothing else changes |

**Isolation guarantees:** rooms are `itv-{sessionId}` and sessions are company-scoped; the
candidate's token joins only their room; the worker's portal JWT is scoped to one session — there is
no code path where tenant A's audio, transcript, or prompt can reach tenant B. Audio quality per
session is SFU-isolated; the only shared resources are worker CPU and vendor rate limits
(Deepgram/OpenRouter concurrency), which is exactly what the per-tenant concurrency quota protects —
one tenant's 50-candidate hiring drive must not consume the whole fleet and starve everyone else's
interviews.

**Worker hosting has two options** (decided at LK-5 with real data, both multi-tenant-identical):
self-managed on Render (`type: worker` — our infra holds the keys, and it rehearses the LK-6
self-host), or **LiveKit Cloud hosted agents** (`lk agent create` — LiveKit runs and autoscales the
same worker code; zero ops, better burst scaling for spiky concurrent-interview load, but a third
party holds the worker's env secrets and there is no self-host rehearsal). Dev can use either; the
CLI path (`winget install LiveKit.LiveKitCLI`, `lk cloud auth`, `lk agent create`) is the fastest
LK-0 loop.

---

# PHASE LK-0 — Accounts, skeleton worker, local loop  (Size: S)

### Why now
Everything after this needs a LiveKit project and proof that a Python worker can join a room from
this repo. Doing it first also surfaces the one genuinely new operational fact — a second runtime —
before any interview logic is written against it.

### Build
- LiveKit Cloud account → project `recruitment-ai-dev` (Build tier, free). Note `LIVEKIT_URL`
  (wss://….livekit.cloud), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- New top-level dir **`agent-worker/`** (own `requirements.txt`, mirroring the three-app layout):
  - `agent.py` — livekit-agents entrypoint; on job request reads
    `{sessionId, portalToken, backendUrl}` from dispatch metadata; hello-world: joins, speaks a
    fixed line via Aura, echoes STT finals to the room as transcription events, exits on empty room.
  - `backend_client.py` — thin HTTP client for the portal endpoints (bearer = portal JWT).
  - `requirements.txt` — `livekit-agents[deepgram,openai,silero,turn-detector]`.
- `docker-compose.yml`: optional `agent-worker` service under a new `agent` profile (build from
  `agent-worker/Dockerfile`, env from `agent-worker/.env`). Default dev workflow stays "run on host":
  `python agent.py dev` (dev mode hot-reloads and registers against LiveKit Cloud).
- `agent-worker/.env.example` documenting: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `BACKEND_URL` (default `http://localhost:9000`).

### Guardrails
- The worker holds real keys → `agent-worker/.env` git-ignored from the first commit, `.env.example`
  documented like `backend/.env.example`.
- Model files (turn detector, Silero) download at build/first-run — pin with
  `python agent.py download-files` in the Dockerfile so a cold deploy never downloads at job time.

### Acceptance gate
- [ ] `python agent.py dev` connects to LiveKit Cloud; a test page (LiveKit Meet or a scratch page)
      joins the same room; you hear the fixed Aura line; your speech appears as a transcription event.
- [ ] `docker compose --profile agent up` produces the same result from the container.
- [ ] No key appears anywhere in the browser or room metadata (verify in devtools).

### Rollback
Delete nothing — the worker registers for an agent name no session dispatches yet. Zero product surface.

---

# PHASE LK-1 — Backend session plumbing + metering webhook  (Size: S–M)

### Why now
The session mint is the consent, budget, and custody gate — it must exist before the worker has
anything real to join. The webhook makes metering server-truth from day one instead of retrofitting it.

### Build
- `backend/controllers/livekitController.js`:
  - `livekitAvailable` — extends the existing availability probe: resolves per-tenant
    `CompanySettings.ai.voiceMode` → `VOICE_MODE`, returns `{available, pipeline}`. Read-only, mints
    nothing (same lesson as the Deepgram probe-mints-session bug).
  - `livekitSession` — same gates as `realtimeSession` (voice consent + `aiInterview.consentOk` +
    `usageService.isOverBudget`), then: create room `itv-{sessionId}`, mint the **candidate's** room
    access token (join-only, no admin grants, TTL = session `expiresAt`), and issue an **explicit
    agent dispatch** whose metadata carries `{sessionId, portalToken, backendUrl}` — dispatch
    metadata goes to the worker only, not to room participants. Stamps `realtimeStartedAt`. Returns
    `{url, token}` to the browser — no Settings block, no model keys, nothing else.
  - Also returned in the payload for the worker (via dispatch metadata reference): the **session
    brief** — `agentPrompt`, function schemas, persona voice, and keyterms from
    `asrVocabularyService` — assembled by `voiceAgentService` so the prompt has ONE source of truth
    in Node; the Python worker renders, it never authors.
- `backend/routes/livekitRoutes.js` — `GET /available`, `POST /session`, `POST /end` mounted at
  `/api/interview-portal/livekit`, same limiter shape as `voiceAgentRoutes.js` (session 6/min).
  `/function` and `/transcript` are NOT duplicated — the worker calls the existing
  `/api/interview-portal/realtime/*` ones.
- `backend/routes/webhooks.js` (or inline in `server.js`): `POST /api/webhooks/livekit` —
  **registered before `express.json()` with a raw-body parser**, exactly like the Razorpay webhook
  and for the same reason (signature verification over original bytes; LiveKit signs with a JWT in
  the `Authorization` header keyed by API key/secret). On `room_finished` for `itv-*` rooms: compute
  duration, stamp `realtimeMeteredAt` idempotently, record `UsageEvent` kind `"realtime"` with
  `meta.provider = "livekit"` and `LIVEKIT_CENTS_PER_MIN` (new env, default `4` until Phase LK-5
  validates real billing). The existing `POST /end` + sendBeacon path stays as the fast client-side
  close; the webhook is the authority that catches killed tabs.
- `backend/models/CompanySettings.js`: `ai.voiceMode` enum += `"livekit"`. `VOICE_MODE` env accepts
  `livekit`. Same both-direction tenant override semantics as today.
- **Per-tenant concurrency quota** (the multi-tenant fairness lever): `livekitSession` counts the
  company's live sessions (`realtimeStartedAt` set within the last 2h, no `realtimeMeteredAt`) and
  refuses above the plan tier's cap (e.g. 2 concurrent on the base plan — plug into `quotaService`
  alongside the existing plan limits). The refusal is a scheduling message to the candidate ("all
  interview slots are busy, please retry in a few minutes"), never an adverse outcome.
- `backend/.env.example`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_CENTS_PER_MIN`, documented in the realtime section.
- npm dep: `livekit-server-sdk` (token mint, dispatch, webhook receiver — Node, backend only).

### Guardrails
- Candidate token: `roomJoin` + publish/subscribe on their room only. Never `roomAdmin`/`roomCreate`.
- Portal JWT rides in dispatch metadata → confirm (test) it is absent from room metadata and from
  every payload the browser can read.
- Webhook is idempotent (`realtimeMeteredAt` guard) — LiveKit retries deliveries.
- Budget gate runs at session mint, same as today; a mid-interview budget breach never cuts audio
  (same policy as the Deepgram path — meter, alert, but don't hang up on a candidate).

### Acceptance gate
- [ ] `POST /livekit/session` refuses without voice consent, without `consentOk`, and over budget —
      with the same error bodies as the Deepgram path.
- [ ] A minted candidate token joins exactly its own room; a second session's token is rejected.
- [ ] `room_finished` webhook writes exactly one UsageEvent per session, replay-safe.
- [ ] `cd backend && npm test` green (new unit tests: token grants, webhook signature + idempotency,
      voiceMode resolution matrix incl. the new enum value).

### Rollback
`VOICE_MODE` unset / tenant `voiceMode` ≠ `livekit` → the availability probe never advertises the
pipeline; endpoints are dead code. No deploy needed.

---

# PHASE LK-2 — The interview loop in the worker  (Size: M–L)

### Why now
This is the core port: the worker becomes the mouth and ears wired to the engine. Everything visible
about "human-like" lands here (turn detection, interruption, latency), so it gets its own gate before
any evidence/guardrail work stacks on top.

### Build
- `agent.py` becomes a real `AgentSession`: Flux STT (with keyterms from the session brief), Aura
  TTS (persona voice), OpenRouter LLM, semantic turn detector + Silero VAD,
  `allow_interruptions=True`.
- System prompt = `agentPrompt` from the session brief, verbatim — the same never-do list, injection
  defense, and words-and-conduct-only warmth section. The worker adds nothing to it.
- Function tools mirror the three schemas and relay to `POST /realtime/function`:
  - `get_next_question` → engine returns `{question, intro?, instruction}`; worker delivers the intro
    then the question **word for word** (same instruction contract as today).
  - `submit_answer` → worker sends args + evidence (Phase LK-3 fills evidence fully; this phase
    sends `{transcript}` minimum — the server already prefers `evidence.transcript` over the
    model's paraphrase).
  - `end_interview` → `confirmed: true` required, as today; the server re-detects dialogue acts and
    can refuse (`WITHDRAW_NOT_CONFIRMED`), which the worker must speak and continue from.
- Error contract: any backend error body becomes a speakable instruction (the existing
  `realtimeFunction` behavior) — the worker speaks it and keeps the session alive; never a dead room.
- On session end (engine says complete, or withdraw confirmed): worker speaks the close, posts
  `POST /livekit/end`, disconnects, room empties → webhook meters.

### Guardrails
- **Worker absent = fall back, never strand.** If the agent hasn't joined within 10s of the
  candidate, the frontend (Phase LK-4) tears down and re-probes availability with
  `exclude=livekit` → Deepgram realtime or turn-based takes over. Infra failure is never adverse:
  the same halted/review semantics as today apply if a session dies mid-interview.
- The worker never computes, stores, or forwards a score. It has three tools; that is its whole
  power surface (same discipline as the Deepgram function schema set).
- One concurrent job per session: dispatch is explicit (no auto-dispatch), and `livekitSession`
  won't dispatch twice for an unexpired room.
- LLM plugin failure (OpenRouter down mid-turn) → worker speaks the standard "give me a moment"
  line once, retries once, then ends gracefully via `end_interview` with reason — engine marks the
  session for review on our side, not the candidate's.

### Acceptance gate
- [ ] Full interview end-to-end in dev: intro delivered with duration + affordances, every question
      asked verbatim (`verifyQuestionsAsked` share ≥ 0.8 at finalization), answers land as turns,
      report generates.
- [ ] Barge-in works: interrupting mid-question stops TTS inside ~300ms and the turn is marked
      interrupted.
- [ ] "I don't know" → decline act → graceful move-on; "I want to stop" → spoken confirmation
      required → `ended_early`, never auto-reject (existing server logic, exercised through the
      new transport).
- [ ] Kill the worker mid-interview → candidate is not stranded (fallback engages) and the session
      lands in review with the fault attributed to us.

### Rollback
Tenant `voiceMode` back to `realtime` or `turn_based`. Worker can be scaled to zero independently.

---

# PHASE LK-3 — Evidence chain + guardrail parity  (Size: M)

### Why now
LK-2 makes it talk; this phase makes it *trustworthy* — the properties that differentiate us. The
pipeline must not ship to any tenant before this gate, because a realtime interview without the
evidence chain is exactly the commodity product the thesis forbids.

### Build
- **Transcript posting (server-side now):** the worker posts every STT-final user utterance and
  every TTS-committed agent utterance to `POST /realtime/transcript` — same endpoint, same guardrail
  scan, same `guardrailHits` append, same halt semantics. The browser's debounce path is not used in
  this pipeline; the guardrail input is now our media path, not the candidate's client.
- **Halt handling:** `{halted, message}` response → worker immediately flushes TTS, speaks
  `HALT_MESSAGE` (which never repeats the offending text), posts `/livekit/end`, closes. Same
  never-adverse `halted` status the engine already implements.
- **Evidence assembly in the worker** (same `sanitizeEvidence` shape, now measured server-side):
  - `transcript` — verbatim Flux finals for the turn (displaces the model's paraphrase; the
    `agentRendering` divergence store keeps working unchanged).
  - `acoustic` — wpm / fillerRate / pauseRatio from transcript + word timings; energyVariance from
    RMS over received audio frames (parity with the browser's `measureAnswer`, computed where the
    candidate can't tamper with it). **Conduct metrics only — no affect, no emotion features; the
    Article 5(1)(f) line and the `emotion_inference` guardrail rule apply unchanged.**
  - `questionDelivery` — `deliveredFully: false` + heard-duration when TTS was interrupted (the
    worker knows precisely, no ~2.7-words/sec estimate needed).
  - `connection` — drops/reconnects from room participant events (WebRTC reconnects are now
    *survivable* but still *recorded* — even one drop keeps withholding the recommendation, as the
    engine already enforces).
- **Dialogue acts:** worker relays candidate meta-speech; the server's `dialogueActs.detect` re-runs
  authoritatively as today (client/worker suggestion, server decision).
- Session brief additions: `clientPolicy()` thresholds and backchannel banks, so pause reassurance
  and withdraw-confirmation phrasing stay the personaService-composed ones.

### Guardrails
- If transcript posting fails (backend blip), the worker buffers and retries; if a turn would be
  submitted with no verbatim transcript attached, it is flagged in evidence — a turn with only a
  model paraphrase must never look like a measured turn (uncertainty visible).
- Rate limits: the transcript limiter (120/min) is keyed by portal JWT and the worker posts at
  spoken-turn cadence — verify headroom in the gate; being throttled here means unchecked speech.

### Acceptance gate
- [ ] Scripted guardrail probe (tester asks the agent an off-script/protected question) → hit
      logged with verbatim utterance; a critical rule halts inside one spoken turn; report shows the
      red banner; verdict forced to REVIEW in the candidate's favor.
- [ ] A turn's stored evidence contains the verbatim Flux transcript, and `agentRendering` is
      populated when the model's paraphrase diverges >50%.
- [ ] Pull the candidate's network for 10s mid-answer → WebRTC reconnects, interview continues,
      `connection.drops ≥ 1` recorded, recommendation withheld.
- [ ] `npm test` green — the existing evidence-chain and guardrail unit suites extended with
      fixtures recorded from this pipeline (`LLM_REPLAY=1` pattern).

### Rollback
Same as LK-2 — flip the tenant flag. Evidence schema changes are additive only.

---

# PHASE LK-4 — Candidate room UI  (Size: M)

### Why now
Everything before this is testable with a scratch client; candidates need the real room, the consent
screen, and the escape hatches before any pilot.

### Build
- `user/` npm dep: `livekit-client`. New hook `user/src/portal/useLiveKitInterview.js` — drastically
  simpler than `useRealtimeInterview.js` (~450 lines → ~150): no AudioWorklet, no RMS sampling, no
  transcript relay, no guardrail debounce, no Settings block. It: fetches `/livekit/session`,
  connects, renders captions from transcription events, exposes phase (connecting / listening /
  speaking / halted / ended), posts `/livekit/end` on unload (webhook is the backstop), and runs the
  10s agent-join watchdog → fallback re-probe.
- `InterviewRoom.jsx`: `livekitMode` added to the pipeline selection (mutual exclusion block above),
  consent screen reused verbatim (consent is pipeline-independent), same halted / ended_early
  screens, same "switch to typing" escape hatch.
- Captions accessibility parity: live text of both sides, as today.

### Guardrails
- The single-pipeline enforcement effect covers three pipelines now — connect when
  `livekitMode && started`, disconnect otherwise; the LK connect is idempotent (same
  `connectingRef` lesson).
- Autoplay policy: audio playback starts from the consent-button gesture (LiveKit needs a user
  gesture on iOS Safari — the consent click is it).

### Acceptance gate
- [ ] A real candidate flow on a phone over mobile data completes an interview: consent → room →
      barge-in works → reconnect survives an elevator moment → report lands.
- [ ] With `voiceMode: "livekit"` off for the tenant, the room runs Deepgram realtime or turn-based
      exactly as before — zero regression in the other two pipelines (smoke the collision matrix).
- [ ] No LiveKit token or URL is requested until consent is granted.

### Rollback
Tenant flag. The hook is dead code when the probe never returns `pipeline: "livekit"`.

---

# PHASE LK-5 — Production deploy + cost validation  (Size: S–M)

### Why now
The plan's whole justification is cost + custody; this phase proves the cost number with real
billing before any paying tenant is flipped.

### Build — deployment runbook

**1. LiveKit Cloud production project** `recruitment-ai-prod` (separate keys from dev). Start on
Build (free) for the smoke test; move to Ship ($50/mo, includes usage credits) when a tenant goes
live. Configure the webhook: dashboard → Webhooks → `https://recruitment-api.onrender.com/api/webhooks/livekit`.

**2. Render — new background worker service** (add to `render.yaml`; the worker dials out to LiveKit
Cloud, so it needs no public port — `type: worker`, not `web`):

```yaml
  # ------------------------------------------------- LiveKit agent worker (Python)
  # Dials out to LiveKit Cloud; no inbound traffic, no public hostname. `starter`, not
  # `free`, for the same reason as the API: a spun-down worker means a candidate sits
  # in an empty room until the 10s watchdog falls back — survivable, but not a pilot
  # experience. Scale instances with concurrent-interview load; each instance handles
  # multiple sessions (async), so one instance covers a pilot comfortably.
  - type: worker
    name: recruitment-agent-worker
    runtime: python
    region: singapore            # same region as the API — worker→backend calls stay fast
    plan: starter
    rootDir: agent-worker
    buildCommand: pip install -r requirements.txt && python agent.py download-files
    startCommand: python agent.py start
    envVars:
      - key: PYTHON_VERSION
        value: "3.12"
      - key: LIVEKIT_URL
        sync: false              # wss://recruitment-ai-prod.livekit.cloud
      - key: LIVEKIT_API_KEY
        sync: false
      - key: LIVEKIT_API_SECRET
        sync: false
      - key: DEEPGRAM_API_KEY
        sync: false              # same key the API uses
      - key: OPENROUTER_API_KEY
        sync: false
      - key: BACKEND_URL
        sync: false              # https://recruitment-api.onrender.com (public URL — Render
                                 # private networking does not span service types reliably;
                                 # calls carry the portal JWT and hit public rate limits, fine)
```

**3. Backend env (Render dashboard, pass-2 style):** `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, `LIVEKIT_CENTS_PER_MIN`. Leave `VOICE_MODE` at its current value — rollout is
per-tenant via `CompanySettings.ai.voiceMode`.

**4. Deploy order:** backend (LK-1 code, inert) → worker (registers, idle) → user SPA (Vercel,
LK-4 code, inert until probe advertises) → flip ONE demo tenant to `voiceMode: "livekit"`.

**5. Cost validation (the actual gate):** run ≥10 full interviews on the demo tenant. Pull LiveKit
Cloud billing + Deepgram usage + OpenRouter usage for those sessions; divide by metered minutes from
our own UsageEvents. Set `LIVEKIT_CENTS_PER_MIN` to the measured all-in number (expected ~2–5¢/min:
agent session $0.01/min + WebRTC ~$0.0005/min + Flux ~$0.008/min + Aura + LLM tokens). If measured
cost exceeds 6¢/min, stop and reconcile before any paying tenant — the migration's premise is the
price.

### Guardrails
- Separate dev/prod LiveKit projects and keys; worker keys never in git (Render dashboard only).
- Alarm on the metering invariant: any `itv-*` `room_finished` without a matching UsageEvent within
  5 min → alert (an unmetered session is silent revenue leakage — same principle as the EmailLog
  noeviction note in `render.yaml`).
- Worker deploys are independent of API deploys: a mid-interview worker restart is a recorded drop +
  reconnect-or-review, verified in the gate below.

### Acceptance gate
- [ ] Smoke on production infra: one full interview per pipeline (turn-based, Deepgram realtime,
      LiveKit) on the demo tenant — all three green, no cross-pipeline collision.
- [ ] Trigger a worker deploy mid-interview → session lands in review attributed to us, candidate
      shown the fault-on-our-side screen, no adverse outcome.
- [ ] Measured cost/min recorded in [COST-AND-CAPACITY.md](COST-AND-CAPACITY.md) with the billing
      screenshots' numbers, and `LIVEKIT_CENTS_PER_MIN` set to it.
- [ ] Rollback drill: flip the demo tenant back to `realtime` in CompanySettings → next session runs
      the Deepgram path, no deploy.

### Rollback
Per-tenant flag (no deploy). Full retreat: scale worker to zero + unset backend LiveKit env → probe
never advertises the pipeline; Deepgram realtime and turn-based are untouched throughout.

---

# PHASE LK-6 — Deferred (explicitly not now)

- **Self-hosted LiveKit server in an Indian region** (DPDP residency) — the reason LiveKit was
  chosen; do it when a tenant contractually needs residency. Changes `LIVEKIT_URL` + keys only;
  nothing else in this plan moves.
- **Second-speaker diarization** in the worker (Flux diarization events → coaching-detection
  evidence) — carried gap from the Deepgram-agent path.
- **Deepgram Voice Agent path retirement** — only after ≥1 quarter of LiveKit parity in production;
  until then it is the working realtime reference and the fallback target.
- **Room recording (LiveKit Egress)** — composes with BUILD-PLAN Phase 14 integrity evidence;
  consent language must be extended first.

---

## Sequencing and effort summary

| Phase | What ships | Size |
|---|---|---|
| LK-0 | Accounts + skeleton worker joining a room | S |
| LK-1 | Session mint, custody, metering webhook (inert) | S–M |
| LK-2 | Full interview loop through the engine | M–L |
| LK-3 | Evidence chain + guardrail parity | M |
| LK-4 | Candidate room UI + fallback watchdog | M |
| LK-5 | Render deploy + measured cost gate | S–M |

Strictly in order, one at a time, each behind the flag — LK-3 is the phase that must never be
skipped or shipped around: without it this is a cheaper commodity voice bot, which is the product
this platform exists to not be.
