"""LiveKit agent worker — the engine's mouth and ears (LIVEKIT-REALTIME-PLAN.md LK-2).

This process registers with LiveKit (Cloud or self-hosted) and joins interview rooms.
The Node backend authors every question, scores every answer, and owns every
decision; this worker renders speech, listens, and relays — nothing else. Nothing
in this file may ever compute, store, or forward a score.

Two modes, decided by dispatch metadata:
  * INTERVIEW  — explicit dispatch from POST /interview-portal/livekit/session, with
    {sessionId, portalToken, backendUrl}. Fetches the session brief (prompt, function
    contract, vocabulary, voice) from the backend and runs the Claim → Probe → Verdict
    interview through the engine's three functions.
  * CONNECTION TEST — no metadata (LK-0 auto-dispatch smoke test via probe_room.py or
    meet.livekit.io). Speaks a fixed line, captions speech, judges nothing.

Run modes (livekit-agents CLI):
  python agent.py download-files   one-time model prefetch (Silero VAD, turn detector)
  python agent.py dev              local dev, verbose logs
  python agent.py start            production (Render worker / Docker CMD)
"""

import asyncio
import json
import logging
import os
import time

from dotenv import load_dotenv

# Load agent-worker/.env before any plugin reads its key from the environment.
load_dotenv()

from livekit import api as lkapi  # noqa: E402
from livekit.agents import (  # noqa: E402
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)

# Plugin imports MUST stay at module top level: livekit-agents registers each plugin on the main
# thread at import time, and an import inside a job entrypoint dies with "Plugins must be
# registered on the main thread" — an empty room and no audio, found the hard way in LK-0.
from livekit.plugins import deepgram, silero  # noqa: E402
from livekit.plugins import openai as openai_plugin  # noqa: E402

# TURN_DETECTOR_ENABLED=0 skips the import entirely — the kill switch for the failure mode
# below. The try/except in build_turn_detection() CANNOT cover this: importing the plugin
# registers an inference runner, and livekit-agents initialises that runner in a separate
# inference process at WORKER STARTUP, before any job exists. If the ONNX session fails to
# load there (missing HF cache, OOM), the child dies, the parent's initialize() takes the
# ChannelClosed branch, and the whole worker exits with "worker failed" — no job ever runs,
# so the job-side guard never gets a chance. Setting this to 0 boots the worker with VAD
# endpointing instead, which is worse turn-taking but a live interviewer.
if (os.getenv("TURN_DETECTOR_ENABLED") or "1").strip() != "0":
    try:
        # Semantic end-of-turn model — the component that makes turn-taking feel human. Module-level
        # import both registers the plugin (main-thread rule above) and lets `download-files` prefetch
        # the weights for the Docker image.
        from livekit.plugins.turn_detector.english import EnglishModel
    except Exception:  # pragma: no cover — plugin layout changed; VAD endpointing still works
        EnglishModel = None
else:
    logging.getLogger("agent-worker").warning(
        "TURN_DETECTOR_ENABLED=0 — semantic end-of-turn disabled, using VAD endpointing"
    )
    EnglishModel = None

logger = logging.getLogger("agent-worker")

# Spoken when the engine halts the interview (guardrail) but the backend's message didn't arrive.
# Mirrors utils/agentGuardrail.HALT_MESSAGE's rules: no repetition of the offending text, nothing
# about the candidate's performance.
FALLBACK_HALT_MESSAGE = (
    "I need to pause this interview here — our team will be in touch with you about next steps. "
    "This is nothing you did; thank you for your time today."
)

FIXED_GREETING = (
    "Hello — this is the recruitment platform's connection test. "
    "If you can hear me clearly, say a sentence or two, and you should "
    "see your words appear as live captions."
)

# Connection test ONLY. The real interviewer prompt is authored by the Node backend
# (voiceAgentService.sessionBrief) — this string must never grow interview behavior.
CONNECTION_TEST_INSTRUCTIONS = (
    "You are a voice connection test for a recruitment platform. Whatever the "
    "user says, reply with ONE short friendly sentence confirming you heard "
    "them, optionally repeating a few of their words back. Never ask interview "
    "questions. Never assess or judge anything."
)

# How long to let the model finish speaking its closing line before tearing the room down.
CLOSE_GRACE_SECONDS = float(os.getenv("AGENT_CLOSE_GRACE_SECONDS", "14"))

# How long to wait for the candidate to actually arrive in the room before giving up on the job.
# Comfortably longer than the browser's own agent-join watchdog (AGENT_JOIN_TIMEOUT_MS = 10s in
# user/src/portal/useLiveKitInterview.js), so the client's fallback is what a candidate experiences
# and this is only the backstop that stops a worker idling in a room nobody came to.
CANDIDATE_JOIN_TIMEOUT = float(os.getenv("AGENT_CANDIDATE_JOIN_TIMEOUT", "45"))


def parse_dispatch_metadata(ctx: JobContext) -> dict:
    """Explicit dispatch carries {sessionId, portalToken, backendUrl}. Log key NAMES only —
    the portal token is a live credential."""
    raw = getattr(ctx.job, "metadata", "") or ""
    try:
        meta = json.loads(raw)
        return meta if isinstance(meta, dict) else {}
    except (ValueError, TypeError):
        return {}


def prewarm(proc: JobProcess):
    # VAD load is ~seconds; doing it per-job would add that to every interview's pickup time.
    proc.userdata["vad"] = silero.VAD.load()


def build_llm():
    """The interviewer's reasoning. OpenRouter by default; a direct provider key if one is set.

    The realtime pipeline has no deterministic no-LLM fallback — backend availability gating
    (livekitService.isEnabled) refuses sessions when the key is missing, so in interview mode this
    never returns None in practice.

    A DIRECT key wins when present, because the proxy hop is paid on every turn and twice on the
    turns that also carry a function call — and that latency is not an abstraction, it is what the
    candidate experiences as the interviewer not listening (the 7–15s turns in
    LIVEKIT-E2E-FINDINGS-2026-08-05.md F4, where the candidate asked three times whether they had
    been heard). OpenRouter stays the fallback: it is the thing that works without a per-provider
    account, and a slower interview beats a dead one.
    """
    direct = (os.getenv("AGENT_LLM_API_KEY") or "").strip()
    key = direct or (os.getenv("OPENROUTER_API_KEY") or "").strip()
    if not key:
        logger.warning("no LLM key set — connection test runs without LLM replies")
        return None
    kwargs = {"api_key": key}
    # Model ids are namespaced per route: "openai/gpt-4o-mini" is OpenRouter's spelling, a direct
    # OpenAI key wants "gpt-4o-mini". Setting AGENT_LLM_API_KEY without also fixing
    # AGENT_LLM_MODEL is the way this gets misconfigured, so the default follows the route.
    if direct:
        base_url = (os.getenv("AGENT_LLM_BASE_URL") or "").strip()
        if base_url:
            kwargs["base_url"] = base_url  # any OpenAI-compatible provider
        kwargs["model"] = os.getenv("AGENT_LLM_MODEL", "gpt-4o-mini")
    else:
        kwargs["base_url"] = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        kwargs["model"] = os.getenv("AGENT_LLM_MODEL", "openai/gpt-4o-mini")
    logger.info("LLM route=%s model=%s", "direct" if direct else "openrouter", kwargs["model"])
    return openai_plugin.LLM(**kwargs)


def build_stt(keyterms: list | None = None):
    model = os.getenv("DEEPGRAM_STT_MODEL", "nova-3")
    # Accent and code-switching are the two variables actually worth trying against a transcript
    # that becomes cited evidence ("en-IN", "hi", "multi"), and there is no way to pick between
    # them from documentation — it has to be measured on real audio. Hardcoding "en" made that
    # comparison a code change; an env var makes it a restart.
    #
    # "multi" is the one that matters for Hindi: it transcribes code-switching within a single
    # utterance, which is how an Indian technical interview is actually spoken ("humne Kubernetes
    # pe migration kiya tha"). "hi" forces monolingual Hindi and mangles the English half.
    language = os.getenv("DEEPGRAM_STT_LANGUAGE", "en")
    kwargs = {"model": model, "language": language}
    terms = [t for t in (keyterms or []) if isinstance(t, str) and t.strip()][:100]
    if terms and model.startswith("nova-3") and not language.lower().startswith("en"):
        # nova-3 keyterm prompting is ENGLISH-ONLY, and Deepgram REJECTS the pairing at connect
        # time rather than ignoring it — so sending it here would cost the whole transcript, not
        # just the biasing. An unbiased transcript is a degraded measurement; no transcript is a
        # dead interview. Dropping the terms is the strictly better failure.
        logger.warning(
            "keyterm prompting is English-only on %s — dropping %d term(s) for language=%s, "
            "continuing with an UNBIASED transcript",
            model,
            len(terms),
            language,
        )
        terms = []
    if terms:
        # Same transcript-vocabulary bias as every other pipeline: without it the words a scorer
        # later reads as evidence are not the words the candidate said.
        #
        # The parameter is MODEL-dependent, not merely plugin-version-dependent, and the plugin
        # raises ValueError (not TypeError) for the wrong pairing — keyterm is nova-3 only,
        # keywords is nova-2-and-older only. A bare `except TypeError` would therefore turn a
        # DEEPGRAM_STT_MODEL change into a crashed job and an empty room, which is the worst way
        # to find out about a config change.
        try:
            if model.startswith("nova-3"):
                # Renamed keyterms→keyterm across plugin versions; try current spelling first.
                for param in ("keyterm", "keyterms"):
                    try:
                        return deepgram.STT(**kwargs, **{param: terms})
                    except TypeError:
                        continue
            else:
                # Weighted keywords: weaker biasing than keyterm prompting, and the only kind
                # nova-2 and older accept. 1.0 is neutral emphasis — enough to make the term
                # reachable without inventing it out of noise.
                return deepgram.STT(**kwargs, keywords=[(t, 1.0) for t in terms])
        except (TypeError, ValueError) as err:
            logger.warning("transcript vocabulary rejected for model %s (%s)", model, err)
        logger.warning("continuing with an UNBIASED transcript on model %s", model)
    return deepgram.STT(**kwargs)


def build_turn_detection():
    """The semantic end-of-turn model, or None to fall back to VAD endpointing.

    Deliberately NOT prewarmed, despite the temptation: EOUModelBase.__init__ resolves its
    inference executor through get_job_context(), which raises outside a job entrypoint, so
    constructing it in prewarm() crashes the worker instead of speeding it up. It is also not
    where the time goes — the ONNX weights load once per WORKER in the shared inference process
    (_InferenceRunner.initialize), not once per job. What happens here is a local
    huggingface-cache lookup and a small JSON read.

    Guarded because that lookup still fails hard when the weights were never fetched
    (`python agent.py download-files`), and a missing model must degrade turn-taking, not end
    the interview.
    """
    if EnglishModel is None:
        return None
    try:
        return EnglishModel()
    except Exception as err:
        logger.warning("turn detector unavailable, using VAD endpointing: %s", err)
        return None


def build_session(ctx: JobContext, *, keyterms=None, voice=None) -> AgentSession:
    kwargs = {
        "vad": ctx.proc.userdata["vad"],
        "stt": build_stt(keyterms),
        "tts": deepgram.TTS(model=voice or os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en")),
        "llm": build_llm(),
    }
    turn_detection = build_turn_detection()
    if turn_detection is not None:
        kwargs["turn_detection"] = turn_detection
    return AgentSession(**kwargs)


async def close_out(ctx: JobContext, backend, *, reason: str):
    """End of the line, whatever the cause: meter, then delete the room. Deleting the room (not
    just leaving it) disconnects the candidate cleanly AND fires the room_finished webhook — the
    authoritative metering backstop — so a worker that dies between these two lines still bills
    correctly."""
    if backend is not None:
        try:
            await backend.end()
        except Exception as err:
            logger.warning("end-metering call failed (webhook will backstop): %s", err)
        try:
            await backend.aclose()
        except Exception:
            pass
    try:
        await ctx.api.room.delete_room(lkapi.DeleteRoomRequest(room=ctx.room.name))
    except Exception as err:
        logger.warning("delete_room failed (%s) — shutting down job instead", err)
        ctx.shutdown(reason=reason)


class InterviewAgent(Agent):
    """The mouth and ears. Its whole power surface is these three tools, each a thin relay onto
    the engine's dispatch — the same contract the Deepgram agent runs. It renders the engine's
    words; it never authors a question, never scores, never decides."""

    def __init__(self, brief: dict, backend, ctx: JobContext):
        super().__init__(instructions=brief["prompt"])
        self._backend = backend
        self._ctx = ctx
        self._closing = False
        # Every committed candidate utterance since the last submit_answer, in order. An answer is
        # almost never one turn: the endpointer commits a long reply in fragments, and any
        # acknowledgement the interviewer makes mid-answer ("got it, thank you") splits it further.
        # Accumulating is the only reading of "what the candidate said to this question" that never
        # silently drops evidence.
        self._pending_user: list[str] = []
        # Wall clock and voiced time for the answer in progress, monotonic seconds. These are the
        # inputs to utils/prosody.audioQuality, which is the ONLY thing standing between a
        # mis-heard answer and a badly-scored candidate: without them every degraded recording
        # reads downstream as a candidate who had nothing to say.
        self._turn_started: float | None = None   # first speech since the last submit_answer
        self._turn_ended: float | None = None     # end of the most recent speech run
        self._speaking_since: float | None = None  # set on listening→speaking, cleared on end
        self._speech_seconds = 0.0                 # voiced time only, summed across runs

    # -- helpers ------------------------------------------------------------

    def note_user_text(self, text: str):
        text = (text or "").strip()
        if text:
            self._pending_user.append(text)

    def note_speech_start(self, now: float):
        if self._speaking_since is None:
            self._speaking_since = now
        if self._turn_started is None:
            self._turn_started = now

    def note_speech_end(self, now: float):
        if self._speaking_since is not None:
            self._speech_seconds += max(0.0, now - self._speaking_since)
            self._speaking_since = None
        self._turn_ended = now

    def _drain_timing(self, now: float) -> tuple[int, float]:
        """(wall-clock ms, voiced seconds) for the answer just finished, then reset.

        Measured from the candidate's FIRST word to their last, not from when the question was
        asked — thinking time before someone starts speaking is not their answer, and counting it
        would penalise the people who think before they talk."""
        if self._speaking_since is not None:  # submit landed mid-run
            self.note_speech_end(now)
        started, ended = self._turn_started, self._turn_ended
        speech = self._speech_seconds
        self._turn_started = self._turn_ended = None
        self._speech_seconds = 0.0
        if started is None or ended is None or ended <= started:
            return 0, 0.0
        return int((ended - started) * 1000), speech

    def _drain_user_text(self, context: RunContext) -> str:
        """The verbatim STT of everything the candidate said since the previous answer — THE
        EVIDENCE. It displaces the model's own rendering server-side
        (voiceAgentService.submitAnswer prefers evidence.transcript), so a paraphrasing model
        cannot become the record.

        This MUST be the whole turn, not its last fragment. Sending only the final committed
        utterance is how a 90-second answer gets recorded as "Thank you." — the verbatim wins over
        the agent's rendering by design, so a truncated verbatim destroys the answer rather than
        degrading it, and the length gap then gets logged as agentRendering, blaming the agent for
        the worker's own mistake."""
        if self._pending_user:
            text = " ".join(self._pending_user).strip()
            self._pending_user.clear()
            if text:
                return text
        # Fallback only: the event relay never fired (older plugin, or a turn committed straight
        # into history). One fragment is still better than handing the scorer a paraphrase.
        try:
            for item in reversed(context.session.history.items):
                if getattr(item, "role", None) == "user":
                    text = (getattr(item, "text_content", None) or "").strip()
                    if text:
                        return text
        except Exception as err:
            logger.warning("could not read user transcript from history: %s", err)
        return ""

    async def _relay(self, name: str, arguments: dict, evidence: dict | None = None) -> dict:
        try:
            response = await self._backend.function_call(name, arguments, evidence)
            result = response.get("result", response)
        except Exception as err:
            # A transport failure must not become a dead conversation — same contract as the
            # backend's own error path: hand the model a speakable instruction.
            logger.error("function %s failed: %s", name, err)
            result = {
                "error": "backend unreachable",
                "instruction": "Something went wrong on our side. Apologise briefly, give it a "
                "moment, then try the function again.",
            }
        return result if isinstance(result, dict) else {"result": result}

    def _schedule_close(self, *, reason: str, grace: float = CLOSE_GRACE_SECONDS):
        if self._closing:
            return
        self._closing = True

        async def later():
            # Give the model time to speak its closing line before the room disappears.
            await asyncio.sleep(grace)
            await close_out(self._ctx, self._backend, reason=reason)

        asyncio.ensure_future(later())

    # -- the three tools (names/params mirror voiceAgentService.functionSchemas) --

    @function_tool
    async def get_next_question(self, context: RunContext) -> str:
        """Get the next interview question to ask. Call this at the start of the interview and
        whenever you need the current question again. Returns the exact wording to use."""
        result = await self._relay("get_next_question", {})
        if result.get("interview_complete"):
            self._schedule_close(reason="interview complete")
        return json.dumps(result)

    @function_tool
    async def submit_answer(self, context: RunContext, answer: str, declined: bool) -> str:
        """Record the candidate's answer to the question you just asked, and get the next
        question. Call this once per question, only after the candidate has clearly finished
        answering. `answer`: everything the candidate said, as close to their own words as
        possible — do not summarise, clean up, or improve it. `declined`: true only if the
        candidate said they could not answer, did not know, had not used the thing being asked
        about, or asked to skip; false for any real attempt, however brief or uncertain."""
        evidence = {}
        transcript = self._drain_user_text(context)
        if transcript:
            evidence["transcript"] = transcript
        # How the answer SOUNDED as a recording — never how the candidate sounded as a person.
        # utils/prosody.audioQuality reads exactly two things off this, and only ever to protect:
        # a near-silent turn or a handful of words stretched over a minute is the signature of a
        # failed capture, and the engine holds that answer back for review instead of scoring it.
        # Nothing here is permitted to describe confidence, mood, or delivery — inferring those
        # from audio in hiring is prohibited outright (EU AI Act Art. 5) and, separately, measures
        # accent and microphone quality rather than ability.
        duration_ms, speech_seconds = self._drain_timing(time.monotonic())
        if duration_ms > 0:
            evidence["audioDurationMs"] = duration_ms
            minutes = duration_ms / 60000.0
            evidence["acoustic"] = {
                "wordsPerMinute": round(len(transcript.split()) / minutes, 1) if minutes else 0.0,
                # Silence as a share of the answer's wall clock.
                "pauseRatio": round(max(0.0, 1.0 - (speech_seconds * 1000.0) / duration_ms), 3),
            }
        result = await self._relay("submit_answer", {"answer": answer, "declined": bool(declined)}, evidence)
        if result.get("interview_complete"):
            self._schedule_close(reason="interview complete")
        return json.dumps(result)

    @function_tool
    async def end_interview(self, context: RunContext, confirmed: bool, reason: str = "") -> str:
        """End the interview early because the candidate asked to stop AND confirmed when you
        asked them to. Never call this without that confirmation, and never call it for any
        other reason."""
        result = await self._relay("end_interview", {"confirmed": bool(confirmed), "reason": reason})
        if result.get("ended"):
            self._schedule_close(reason="candidate withdrew")
        return json.dumps(result)


def wire_transcript_relay(session: AgentSession, agent: InterviewAgent, backend, ctx: JobContext):
    """Every sentence either side speaks goes to the backend, verbatim. This is the audit record —
    'what exactly was said in this interview?' — and, for the interviewer's half, the guardrail
    input and the halt path: a critical finding stops the interview inside one spoken turn, never
    adversely to the candidate.

    The candidate's half is stored SEPARATELY and is never scored (see the backend's
    candidateUtterances). It exists so that "I told it I couldn't hear anything" is answerable."""

    async def flush(text: str, role: str = "assistant"):
        try:
            response = await backend.post_transcript(
                [{"text": text, "role": role, "at": int(time.time() * 1000)}]
            )
        except Exception as err:
            logger.warning("transcript post failed (guardrail input!): %s", err)
            return
        if response.get("halted"):
            logger.error("guardrail HALT on session — ending now")
            try:
                session.interrupt()
            except Exception:
                pass
            try:
                await session.say(response.get("message") or FALLBACK_HALT_MESSAGE, allow_interruptions=False)
            except Exception:
                pass
            agent._closing = True  # suppress any racing scheduled close
            await close_out(ctx, backend, reason="guardrail halt")

    @session.on("conversation_item_added")
    def on_item(ev):
        item = getattr(ev, "item", None)
        role = getattr(item, "role", None)
        text = (getattr(item, "text_content", None) or "").strip()
        if not text:
            return
        if role == "assistant":
            asyncio.ensure_future(flush(text))
        elif role == "user":
            # Buffered here, drained by submit_answer. Committed utterances only — this event
            # fires on turn commit, never on interim STT — so the buffer holds finals, in order,
            # and always before the tool call that reads it.
            agent.note_user_text(text)
            # And posted, so the candidate's side of the conversation survives too. ONE source and
            # one segmentation for both uses: the alternative — a second capture path — is how a
            # record of what a candidate said starts disagreeing with itself.
            asyncio.ensure_future(flush(text, role="candidate"))

    # Turn timing for the audio-quality evidence. VAD-derived, so it measures the RECORDING
    # (did we capture speech at all?) and never the speaker. See InterviewAgent._drain_timing.
    @session.on("user_state_changed")
    def on_user_state(ev):
        now = time.monotonic()
        if getattr(ev, "new_state", None) == "speaking":
            agent.note_speech_start(now)
        elif getattr(ev, "old_state", None) == "speaking":
            agent.note_speech_end(now)


async def run_interview(ctx: JobContext, meta: dict):
    from backend_client import BackendClient

    backend = BackendClient(
        meta.get("backendUrl") or os.getenv("BACKEND_URL", "http://localhost:9000"),
        meta["portalToken"],
    )

    try:
        brief = await backend.get_brief()
    except Exception as err:
        # No brief ⇒ no interview. Tear down instead of improvising: the client's agent-join
        # watchdog falls back to the next pipeline, and infra failure is never adverse.
        logger.error("session brief fetch failed: %s", err)
        await close_out(ctx, backend, reason="brief fetch failed")
        return

    logger.info(
        "interview job: room=%s promptVersion=%s keyterms=%d",
        ctx.room.name,
        brief.get("promptVersion"),
        len(brief.get("keyterms") or []),
    )

    session = build_session(ctx, keyterms=brief.get("keyterms"), voice=brief.get("voice"))
    agent = InterviewAgent(brief, backend, ctx)
    wire_transcript_relay(session, agent, backend, ctx)

    # Candidate gone = interview over. Meter and clean up rather than idling in an empty room.
    def on_leave(*_args):
        if not ctx.room.remote_participants and not agent._closing:
            agent._closing = True
            logger.info("candidate left room %s — closing out", ctx.room.name)
            asyncio.ensure_future(close_out(ctx, backend, reason="candidate left"))

    ctx.room.on("participant_disconnected", on_leave)

    # WAIT FOR THE CANDIDATE. Not defensive coding — without this the interview is silent.
    #
    # We are in the room FIRST, and reliably so: the backend dispatches this job partway through
    # POST /interview-portal/livekit/session (livekitController) and only afterwards writes the
    # session and returns the room token, so the browser's connect has not even begun when ours
    # completes. Greeting at that moment speaks the introduction and the first question into an
    # empty room — and then waits for an answer from someone who never heard the question. Both
    # sides wait for the other, forever. It presents as "the interviewer never says anything and
    # there is no audio at all", with nothing in the logs looking wrong, because nothing failed.
    #
    # Starting the session only once they are here also means our audio track is published to a
    # room they are already subscribing in, so the opening line cannot be half-missed either.
    try:
        participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=CANDIDATE_JOIN_TIMEOUT)
        logger.info("candidate %s joined room %s", participant.identity, ctx.room.name)
    except asyncio.TimeoutError:
        logger.error("no candidate joined room %s in %ss — closing out", ctx.room.name, CANDIDATE_JOIN_TIMEOUT)
        await close_out(ctx, backend, reason="candidate never joined")
        return

    await session.start(agent=agent, room=ctx.room)
    try:
        await session.generate_reply(
            instructions="The interview is beginning now. Call get_next_question and follow its "
            "instruction exactly."
        )
    except Exception as err:
        # The opening turn is the one failure that is indistinguishable from working correctly:
        # the room is up, the candidate is connected, the agent is present, and nobody ever
        # speaks. Close out loudly rather than leave them sitting in silence — an interview that
        # ends is recoverable, an interview that hangs is just a candidate waiting.
        logger.error("opening turn failed (%s) — candidate would hear silence, closing out", err)
        await close_out(ctx, backend, reason="opening turn failed")
        return
    logger.info("opening turn delivered on room %s", ctx.room.name)


async def run_connection_test(ctx: JobContext):
    def on_leave(*_args):
        if not ctx.room.remote_participants:
            logger.info("room %s is empty — shutting down job", ctx.room.name)
            ctx.shutdown(reason="room empty")

    ctx.room.on("participant_disconnected", on_leave)

    session = build_session(ctx)
    # Same rule as the interview path: greet nobody and the smoke test "passes" in silence, which
    # is the worst possible result from the one job whose entire purpose is proving audio works.
    # (Auto-dispatch usually means they are already here, in which case this returns at once.)
    try:
        await asyncio.wait_for(ctx.wait_for_participant(), timeout=CANDIDATE_JOIN_TIMEOUT)
    except asyncio.TimeoutError:
        logger.error("no participant joined room %s — shutting down job", ctx.room.name)
        ctx.shutdown(reason="nobody joined")
        return
    await session.start(agent=Agent(instructions=CONNECTION_TEST_INSTRUCTIONS), room=ctx.room)
    await session.say(FIXED_GREETING, allow_interruptions=True)


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    meta = parse_dispatch_metadata(ctx)
    logger.info(
        "job accepted: room=%s metadata-keys=%s",
        ctx.room.name,
        sorted(meta.keys()) or "(none — connection test)",
    )
    if meta.get("sessionId") and meta.get("portalToken"):
        await run_interview(ctx, meta)
    else:
        await run_connection_test(ctx)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            # Empty agent_name => auto-dispatch (joins any new room; the LK-0 dev loop). Setting
            # AGENT_NAME switches to explicit dispatch: only the backend's session mint — carrying
            # the portal JWT — can summon an interviewer, and random rooms get nobody.
            agent_name=(os.getenv("AGENT_NAME") or "").strip(),
        )
    )
