// Self-orchestrated realtime voice on LiveKit — LIVEKIT-REALTIME-PLAN.md, Phase LK-1.
//
// The platform's ONLY realtime voice pipeline (the Deepgram Voice Agent transport it superseded
// has been removed; turn-based remains the default and the fallback floor). The custody story is
// the reason it won: the browser receives a join-only room token and nothing else — no Settings
// block, no model keys, no transcript-relay duty. The Python worker (agent-worker/) holds the
// speech keys server-side and reaches the engine through the /api/interview-portal/realtime/*
// endpoints, authenticated with the candidate's own portal JWT handed over in agent-dispatch
// metadata (worker-only; never visible to room participants).
//
// Everything here is plumbing. The engine (aiInterviewService via voiceAgentService.dispatch)
// stays the sole question author and scorer, whichever pipeline carries the audio.

const CompanySettings = require("../models/CompanySettings"); // eslint-disable-line no-unused-vars — kept for parity with sibling services' imports
const InterviewSession = require("../models/InterviewSession");
const usageService = require("./usageService");
const speech = require("./speechService");
const llm = require("./llmService");
const tenantContext = require("../utils/tenantContext");
const { publicBaseUrl } = require("../utils/corsOrigins");

const ROOM_PREFIX = "itv-";

// A realtime session that never closed cleanly still stops counting against the tenant's
// concurrency cap after this window — a crashed worker must not brick a company's interviewing.
// The metering webhook normally closes sessions long before this matters.
const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

function configured() {
  return Boolean(
    process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET
  );
}

// Off unless explicitly enabled. Turn-based is the default and the always-available floor: a
// livekit session that cannot start must drop the candidate back to it rather than cost them
// their interview.
function isEnabled(settings) {
  if (!configured()) return false;
  // The worker's STT/TTS is Deepgram and its reasoning is OpenRouter, and there is no
  // deterministic fallback once the audio is live. No keys ⇒ refuse up front, client falls back
  // to turn-based.
  if (!speech.isEnabled()) return false;
  if (!llm.isEnabled()) return false;
  const tenant = settings?.ai?.voiceMode;
  if (tenant === "livekit") return true;
  // ANY other explicit value pins the tenant off this pipeline — including the legacy "realtime"
  // string left in older CompanySettings docs by the retired Deepgram-agent pipeline, which must
  // land those tenants safely on turn-based, never on a pipeline they didn't choose.
  if (tenant) return false;
  return String(process.env.VOICE_MODE || "").toLowerCase() === "livekit";
}

function agentName() {
  return String(process.env.LIVEKIT_AGENT_NAME || "recruitment-interviewer").trim();
}

function roomName(session) {
  return `${ROOM_PREFIX}${session._id}`;
}

// Inverse of roomName, used by the metering webhook. Strict: a webhook event for a room we did
// not name (someone else's project traffic, a typo'd manual room) must map to nothing.
function sessionIdFromRoom(name) {
  const s = String(name || "");
  if (!s.startsWith(ROOM_PREFIX)) return null;
  const id = s.slice(ROOM_PREFIX.length);
  return /^[a-f0-9]{24}$/i.test(id) ? id : null;
}

// LIVEKIT_URL is the client-facing wss:// endpoint; the server SDK's REST clients want https://.
function httpUrl() {
  return String(process.env.LIVEKIT_URL || "")
    .replace(/^wss:/i, "https:")
    .replace(/^ws:/i, "http:");
}

// The candidate's room credential: join THEIR room, publish mic, subscribe to the agent. Nothing
// else — no roomCreate, no roomAdmin, no roomList. TTL tracks the interview session's own expiry
// (same derivation as the portal JWT) so a leaked token dies with the session.
async function mintCandidateToken(session) {
  const { AccessToken } = require("livekit-server-sdk");
  const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : NaN;
  const msLeft = Number.isFinite(expiresAt) ? expiresAt - Date.now() : NaN;
  const ttl = Number.isFinite(msLeft) ? Math.max(60, Math.min(3 * 3600, Math.floor(msLeft / 1000))) : 3600;

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `candidate-${session._id}`,
    ttl,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName(session),
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    roomCreate: false,
    roomAdmin: false,
    roomList: false,
  });
  return at.toJwt();
}

// Explicit dispatch: summon the worker into this session's room, carrying the ONLY context it
// gets — the session id, the candidate's portal JWT (its credential for the /realtime/* function
// endpoints), and a backend URL hint. Dispatch metadata is delivered to the worker's job request,
// NOT to room participants, which is why the portal token may ride in it: the only party who
// could read it server-side already holds broader credentials, and the candidate it names
// already owns it.
//
// Guarded against double-summoning: a reconnecting candidate re-mints a token, but a second
// dispatch into a room that still has an agent would seat two interviewers.
async function dispatchAgent(session, portalToken) {
  const { AgentDispatchClient } = require("livekit-server-sdk");
  const client = new AgentDispatchClient(httpUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  const room = roomName(session);

  try {
    const existing = await client.listDispatch(room);
    if ((existing || []).some((d) => d.agentName === agentName())) {
      return { dispatched: false, reason: "agent already dispatched to this room" };
    }
  } catch (err) {
    // Best-effort duplicate guard, not a gate — on a fresh room this can 404 depending on
    // server version, and refusing to dispatch because we couldn't LIST would strand the room.
    console.warn(`[livekit] listDispatch failed for ${room} (continuing): ${err.message}`);
  }

  const metadata = JSON.stringify({
    sessionId: String(session._id),
    portalToken,
    // normalizeBase, not the raw env: a schemeless host reaches the worker as an
    // httpx URL error, and the interview dies before the first question.
    backendUrl: publicBaseUrl(),
  });
  await client.createDispatch(room, agentName(), { metadata });
  return { dispatched: true };
}

// LiveKit bills per session-minute like the Deepgram agent but at a different (lower) rate, so it
// gets its own knob. Default is the plan's pre-validation estimate; Phase LK-5's cost gate
// replaces it with the measured all-in number before any paying tenant is enabled.
function costCents(durationMs) {
  const perMin = Number(process.env.LIVEKIT_CENTS_PER_MIN || 4);
  return Math.round((Math.max(0, durationMs) / 60000) * perMin * 100) / 100;
}

// Close out a session's billing window. Idempotent (realtimeMeteredAt guard) because it has THREE
// callers that can race: the client's /end on disconnect, sendBeacon on tab close, and the
// room_finished webhook — and a double-report must not double-bill. Shared with the Deepgram
// path's field names so recruiter reporting reads one schema.
async function meterSession(session) {
  const ai = session.aiInterview;
  const startedAt = ai?.realtimeStartedAt;
  if (!startedAt || ai?.realtimeMeteredAt) return { metered: false };

  const durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  // Atomic test-and-set, NOT doc.save(): three callers race here (client /end, sendBeacon,
  // webhook) and, worse, a doc-level save() at interview end bumps the version under the slow
  // detached finalization and fails it with a VersionError — found live in the LK-2 e2e. The
  // filter is the idempotency guard: exactly one caller matches, everyone else no-ops.
  const result = await InterviewSession.updateOne(
    { _id: session._id, "aiInterview.realtimeMeteredAt": null, "aiInterview.realtimeStartedAt": { $ne: null } },
    { $set: { "aiInterview.realtimeMeteredAt": new Date(), "aiInterview.realtimeDurationMs": durationMs } }
  );
  if (!result.modifiedCount) return { metered: false };
  ai.realtimeMeteredAt = new Date();
  ai.realtimeDurationMs = durationMs;

  try {
    await usageService.recordUsage({
      company: session.company,
      session: session._id,
      candidate: session.candidate,
      kind: "realtime",
      provider: "livekit",
      model: "agent-worker",
      usage: { costCents: costCents(durationMs) },
      latencyMs: durationMs,
      engine: "ai",
    });
  } catch (err) {
    console.error("[livekit] session metering failed:", err.message);
  }
  return { metered: true, durationMs };
}

// The webhook is the AUTHORITATIVE meter: it fires when the room actually closed, which catches
// the killed-tab / crashed-worker cases the client-side /end cannot. Runs as system — a webhook
// has no tenant context, and the room name is the only routing key.
async function handleWebhookEvent(event) {
  if (!event || event.event !== "room_finished") return { handled: false, reason: "not room_finished" };
  const sessionId = sessionIdFromRoom(event.room?.name);
  if (!sessionId) return { handled: false, reason: "not an interview room" };

  return tenantContext.runAsSystem(async () => {
    const session = await InterviewSession.findById(sessionId);
    if (!session) return { handled: false, reason: "no such session" };
    const result = await meterSession(session);
    return { handled: true, ...result };
  });
}

// How many of this company's realtime sessions are live right now — the fairness denominator for
// the per-tenant concurrency cap (multi-tenant plan §4: one tenant's hiring drive must not starve
// every other company's interviews).
async function activeSessionCount(companyId) {
  return InterviewSession.countDocuments({
    company: companyId,
    "aiInterview.realtimeStartedAt": { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
    "aiInterview.realtimeMeteredAt": null,
  });
}

module.exports = {
  configured,
  isEnabled,
  agentName,
  roomName,
  sessionIdFromRoom,
  httpUrl,
  mintCandidateToken,
  dispatchAgent,
  costCents,
  meterSession,
  handleWebhookEvent,
  activeSessionCount,
  ACTIVE_WINDOW_MS,
};
