# Voice Pipeline Guide — deploy it, use it, switch it

> The operator's manual for the two voice-interview pipelines: how to run the LiveKit realtime
> pipeline with the current setup, how to deploy it to production, and how to switch any tenant
> between pipelines (and back) without a deploy.
> Companions: [AI-INTERVIEWER-EXPLAINED.md](AI-INTERVIEWER-EXPLAINED.md) (what the interviewer
> does, where questions come from, how it picks the next one),
> [LIVEKIT-REALTIME-PLAN.md](LIVEKIT-REALTIME-PLAN.md) (architecture + phases),
> [DEPLOY.md](DEPLOY.md) Part 5 (production steps in full), [STATUS.md](STATUS.md) §E (what is
> verified), [AI-INTERVIEW-CONVERSATION-EXAMPLES.md](AI-INTERVIEW-CONVERSATION-EXAMPLES.md)
> (what the candidate experiences).

> **History note:** a third pipeline — `realtime`, the Deepgram Voice Agent transport — existed
> between the two below and was removed on 2026-08-06 after the LiveKit pipeline replicated its
> whole behaviour with better key custody at a lower per-minute cost. Legacy
> `ai.voiceMode: "realtime"` values in old CompanySettings docs are treated as an explicit
> non-livekit pin (i.e. turn_based); the engine endpoints it introduced
> (`/api/interview-portal/realtime/function|transcript`) live on unchanged as the LiveKit
> worker's contract.

---

## 1. The two pipelines at a glance

| | `turn_based` | `livekit` |
|---|---|---|
| Candidate experience | Ask → listen → next question | Continuous conversation |
| Barge-in / interrupt | Limited (echo-gated) | Yes (semantic turn detection) |
| Transport | WebSocket audio | **WebRTC** (auto-reconnect, mobile-network resilient) |
| Keys in the browser | No | **No keys, no prompt — join-token only** |
| Est. cost / 20-min interview | ~$0.20 | ~$0.40–1.00 (validate at LK-5) |
| No-LLM fallback | Yes (deterministic engine) | No — refuses up front |
| Status | Default everywhere, the floor | Live-verified locally; production deploy pending |

**What never changes across pipelines:** the engine authors every question from the tenant's
rubric (delivered verbatim, audited), scores are computed by code over verbatim transcripts,
declines/withdrawals are never adverse, the guardrail scans every interviewer utterance, and
consent gates every microphone. Switching pipelines changes the *transport*, never the interview.

---

## 2. Switching between pipelines

### The switch itself

One field decides everything: **`CompanySettings.ai.voiceMode`** per tenant, falling back to the
**`VOICE_MODE`** env default when unset. An explicit tenant value pins that tenant to exactly one
pipeline — the two are mutually exclusive by construction, so no combination of settings can
ever run two pipelines at once.

Three ways to flip it:

```bash
# 1. CLI (fastest) — works locally and against production's DB
cd backend
node scripts/setVoiceMode.js admin@demo.test livekit      # this tenant → LiveKit
node scripts/setVoiceMode.js admin@demo.test turn_based   # rollback
node scripts/setVoiceMode.js admin@demo.test unset        # defer to VOICE_MODE env
```

```bash
# 2. API — what a recruiter/admin token can do (PATCH semantics)
curl -X PUT https://<api>/api/company-settings \
  -H "Authorization: Bearer <admin JWT>" -H "Content-Type: application/json" \
  -d '{"ai":{"voiceMode":"livekit"}}'        # "" clears it back to the env default
```

```bash
# 3. Env default (global — avoid; prefer per-tenant)
# backend/.env or Render dashboard:
VOICE_MODE=turn_based    # the deployment-wide default for tenants with no explicit choice
```

### Rules to know

- **Takes effect on the next interview session.** A live interview is never yanked mid-conversation.
- **Rollback is the same command, instantly, no deploy.** That is the whole design: adopt one
  tenant at a time, retreat in one line.
- **Never flip `VOICE_MODE` globally to `livekit`.** It costs more per minute and changes what
  every candidate experiences — per-tenant adoption only (the env default exists so dev machines
  can test without touching tenant rows).
- **The candidate always lands somewhere.** The room probes LiveKit availability first; if the
  pipeline is enabled but fails at runtime (worker down, dispatch failure, agent no-show past the
  10s watchdog), the room falls back to the turn-based interview automatically. Typed answers
  remain available inside every pipeline.

### How to verify which pipeline a tenant is on

```bash
# What the room will decide (candidate portal JWT):
GET /api/interview-portal/livekit/available     → {"enabled": true|false}
# After a session, in Mongo: UsageEvent {kind:"realtime", provider:"livekit"} —
# or absent entirely for a turn-based interview.
```

---

## 3. Using it with the current (local) setup

Everything below is already installed and verified on this machine.

### Start the stack (4 terminals, or let each run detached)

```bash
# 1. Infra (Mongo local, Redis, MinIO — note the app DB itself is Atlas via backend/.env)
docker compose up -d

# 2. Backend API on :9000
cd backend && npm start

# 3. The LiveKit agent worker (Python 3.11 venv, keys in agent-worker/.env)
cd agent-worker && .venv/Scripts/python agent.py dev
#   → wait for the log line: registered worker … "agent_name": "recruitment-interviewer"

# 4. Candidate SPA on :5174
cd user && npm run dev
```

### Run an interview

```bash
cd backend
node scripts/setVoiceMode.js admin@demo.test livekit   # once — the demo tenant is already flipped
node scripts/_seedLiveKitE2E.js                        # prints {sessionId, token}
```

Open `http://localhost:5174/interview/<token>` → pre-checks → **Agree & start interview** →
talk to Ava. Interrupt her mid-question, ask her to repeat, say "I don't know", say "I want to
stop" — every behaviour in [AI-INTERVIEW-CONVERSATION-EXAMPLES.md](AI-INTERVIEW-CONVERSATION-EXAMPLES.md)
is live. Afterwards the report (admin SPA, or `GET /api/candidates/:id` as the recruiter) shows
the scored, cited evaluation.

Scripted alternatives (no microphone needed):

```bash
cd agent-worker
LK_PROBE_JWT=<portal jwt> .venv/Scripts/python interview_probe.py                        # full interview
LK_PROBE_JWT=<portal jwt> PROBE_SCRIPT=withdraw .venv/Scripts/python interview_probe.py  # decline+withdraw
LK_PROBE_JWT=<portal jwt> PROBE_SCRIPT=bargein  .venv/Scripts/python interview_probe.py  # interruptions
# (portal jwt = POST /api/interview-portal/login {token} → .token)
```

### Local troubleshooting

| Symptom | Cause / fix |
|---|---|
| Candidate waits, then "switching to the standard voice interview" | Worker not running or not registered — check terminal 3 for the `registered worker` line; `AGENT_NAME` in `agent-worker/.env` must be `recruitment-interviewer` |
| Backend restart "EADDRINUSE :9000" | An orphaned node still holds the port: PowerShell `Get-NetTCPConnection -LocalPort 9000 -State Listen \| % { Stop-Process -Id $_.OwningProcess -Force }` |
| Ad-hoc DB scripts fail `querySrv ECONNREFUSED` | Atlas SRV lookup needs the DNS override: start scripts with `require("./config/dnsOverride").applyDnsOverride()` (all repo scripts already do) |
| Agent joins but never speaks / crashes | Check worker log; plugin imports must stay at module top of `agent.py` |
| Guardrail events | Watch backend console for `[guardrail]` lines; hits are stored on the session |

---

## 4. Deploying to production

The condensed path — full detail in [DEPLOY.md](DEPLOY.md) Part 5 (steps 13–15). Everything
ships **inert**: deploy it all, and nothing changes for anyone until a tenant is flipped.

**1. LiveKit Cloud production project.** Separate from dev: `recruitment-ai-prod` → Settings →
Keys. Then dashboard → **Webhooks** → `https://<your-api>.onrender.com/api/webhooks/livekit`.
The webhook is the authoritative metering close (killed tabs, crashed workers) and is
**untestable locally** — verify it here: finish one interview without a clean disconnect and
confirm the `UsageEvent` still appears.

**2. Render.** The Blueprint already defines everything. Sync it, then fill in the dashboard:
- `recruitment-api`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_CENTS_PER_MIN` (leave `VOICE_MODE` alone — rollout is per-tenant).
- `recruitment-agent-worker` (new Python worker, Singapore, starter): same three LiveKit vars +
  `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `BACKEND_URL` (the public API URL), and
  `AGENT_NAME=recruitment-interviewer` (already set in the Blueprint — must match the API's
  `LIVEKIT_AGENT_NAME`).

**3. Deploy order:** API → worker → SPAs (Vercel redeploys pick up the LK-4 room code). All inert.

**4. Pilot one tenant.**
```bash
node scripts/setVoiceMode.js <pilot-admin-email> livekit
```
Run ≥10 full interviews — include a phone on mobile data (reconnect in an elevator, barge in,
withdraw once). Listen for latency; watch `[guardrail]` logs.

**5. The cost gate (do not skip).** Pull LiveKit + Deepgram + OpenRouter billing for those
sessions, divide by the metered minutes from your own UsageEvents, set `LIVEKIT_CENTS_PER_MIN`
to the measured number. **Above 6¢/min: stop and reconcile before any paying tenant** — the
migration's premise is the price.

**Rollback at any depth:** tenant → `setVoiceMode.js <tenant> turn_based` (instant, no deploy);
whole pipeline → scale `recruitment-agent-worker` to zero and unset the API's `LIVEKIT_*` vars —
the availability probe stops advertising it and every tenant quietly lands on the turn-based
interview. The turn-based interview is always the floor.
