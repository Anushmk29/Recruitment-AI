"""LK-2 gate probe — a scripted candidate that sits the whole interview.

Automates the live end-to-end: mints the LiveKit session through the real portal
endpoint (which also creates the agent dispatch), joins the room as the candidate,
waits for the interviewer to speak, and answers each question with synthesized
speech — including one deliberate "I don't know" to exercise the decline path.
Prints a JSON report of everything heard and said; the DB-side verification
(turns, verbatim delivery, metering) happens separately against Mongo.

Usage:
  LK_PROBE_JWT=<portal jwt> .venv/Scripts/python interview_probe.py
"""

import asyncio
import json
import os
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

from livekit import rtc  # noqa: E402

BACKEND = os.getenv("BACKEND_URL", "http://localhost:9000").rstrip("/")
JWT = os.environ["LK_PROBE_JWT"]
DG_KEY = os.environ["DEEPGRAM_API_KEY"]

SAMPLE_RATE = 48000
QUIET_SECONDS = 2.8  # agent silent this long after speaking ⇒ our turn
MAX_RUNTIME = 420.0

# The withdraw drill: a real answer, a TERSE decline (within the deterministic dialogue-act
# word budget, unlike the wordy hedge in the full script), then a spoken withdrawal that the
# agent must ask to confirm before calling end_interview(confirmed=true). Never auto-reject.
WITHDRAW_ANSWERS = [
    "Sure — my name is Lk Probe, and I have been building Node dot js services for about five years.",
    "I don't know.",
    "I want to stop the interview now, please.",
    "Yes, I am sure. Please stop the interview.",
    "Yes.",
]

ANSWERS = [
    "Sure — my name is Lk Probe, I have about five years of backend experience, "
    "mostly building Node dot js services on Kubernetes with PostgreSQL as the main data store.",
    "In my last role I designed a REST API for payments. We ran it as microservices on "
    "Kubernetes, and I owned the schema design and query tuning in PostgreSQL.",
    "I'm sorry, I don't know that one — I haven't worked with it, so I'd rather skip it than guess.",
    "One approach I like is horizontal scaling behind a load balancer, keeping the services "
    "stateless, and caching hot reads in Redis.",
    "Yes — I once debugged a connection pool leak in production by tracing open handles and "
    "adding proper pool limits, and we added an alert so it could not regress silently.",
    "For testing I lean on integration tests against a real database in CI, plus contract tests "
    "for the API boundaries.",
    "I usually start with the slow query log, then explain-analyze the worst offenders, and add "
    "indexes or rewrite the access pattern.",
    "Deployment wise, we used rolling updates with readiness probes, and canaried risky changes "
    "behind a feature flag.",
    "I document the decision in a short design note, get review from the team, and revisit it "
    "when the assumptions change.",
    "That is a good question — in my experience the key is monitoring, clear ownership, and "
    "small reversible deployments.",
    "Mostly I have used Redis for caching and BullMQ for background jobs in Node services.",
    "Thank you — that covers what I wanted to share on that topic.",
]

if os.getenv("PROBE_SCRIPT", "full") == "withdraw":
    ANSWERS = WITHDRAW_ANSWERS

# Barge-in mode: don't wait for quiet — cut in ~2s into the agent's own speech and measure how
# quickly its audio actually stops. The plan's gate asks for ~300ms; LiveKit 1.5's audio-based
# interruption model owns this, the probe just measures it.
BARGE_IN = os.getenv("PROBE_SCRIPT", "full") == "bargein"


async def synthesize(text: str) -> bytes:
    """Deepgram Aura REST → raw linear16 mono PCM at SAMPLE_RATE."""
    async with httpx.AsyncClient(timeout=30.0) as http:
        r = await http.post(
            "https://api.deepgram.com/v1/speak",
            params={"model": "aura-2-luna-en", "encoding": "linear16", "sample_rate": str(SAMPLE_RATE), "container": "none"},
            headers={"Authorization": f"Token {DG_KEY}"},
            json={"text": text},
        )
        r.raise_for_status()
        return r.content


def rms(data: memoryview) -> float:
    # Cheap int16 RMS proxy: average absolute value over a stride.
    total = 0
    count = 0
    b = bytes(data)
    for i in range(0, len(b) - 1, 64):
        sample = int.from_bytes(b[i : i + 2], "little", signed=True)
        total += abs(sample)
        count += 1
    return total / max(1, count)


async def main():
    started = time.monotonic()
    report = {
        "session_mint": None,
        "agent_joined": False,
        "captions": [],
        "answers_spoken": [],
        "disconnected": None,
        "errors": [],
    }

    # 1. Mint the session through the REAL endpoint — this is also the live test of the
    #    consent/budget/concurrency gates and the agent dispatch.
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post(
            f"{BACKEND}/api/interview-portal/livekit/session",
            headers={"Authorization": f"Bearer {JWT}"},
            json={},
        )
        report["session_mint"] = {"status": r.status_code}
        if r.status_code != 200:
            report["errors"].append(f"session mint failed: {r.text[:300]}")
            print(json.dumps(report, indent=2))
            return
        mint = r.json()

    room = rtc.Room()
    agent_last_active = {"t": 0.0, "ever": False, "spoke_since_answer": False, "speech_start": 0.0}
    activity_log = []  # agent-audio activity timestamps (~10Hz), for barge-in latency math

    @room.on("participant_connected")
    def on_participant(p):
        report["agent_joined"] = True

    async def read_audio(track):
        stream = rtc.AudioStream(track)
        async for event in stream:
            frame = event.frame
            if rms(frame.data) > 200:
                now = time.monotonic()
                if now - agent_last_active["t"] > 1.0:
                    agent_last_active["speech_start"] = now  # a new agent utterance began
                agent_last_active["t"] = now
                agent_last_active["ever"] = True
                agent_last_active["spoke_since_answer"] = True
                if not activity_log or now - activity_log[-1] > 0.1:
                    activity_log.append(now)

    @room.on("track_subscribed")
    def on_track(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            asyncio.ensure_future(read_audio(track))

    def on_text(reader, participant_identity):
        async def consume():
            text = (await reader.read_all()).strip()
            if text:
                report["captions"].append({"t": round(time.monotonic() - started, 1), "text": text})

        asyncio.ensure_future(consume())

    try:
        room.register_text_stream_handler("lk.transcription", on_text)
    except Exception:
        pass

    @room.on("disconnected")
    def on_disconnect(reason=None):
        report["disconnected"] = str(reason)

    await room.connect(mint["url"], mint["token"])

    # 2. Publish our microphone.
    source = rtc.AudioSource(SAMPLE_RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mic", source)
    # MUST be marked SOURCE_MICROPHONE: the agent's RoomIO only attaches to microphone-source
    # tracks (accepted_sources), and an unmarked track is silently ignored — the agent waits for
    # "input speech" forever. A real browser's getUserMedia track carries this automatically.
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )

    async def speak(text: str):
        pcm = await synthesize(text)
        samples_per_frame = SAMPLE_RATE // 100  # 10ms
        step = samples_per_frame * 2  # int16 mono ⇒ 2 bytes/sample
        for i in range(0, len(pcm) - step + 1, step):
            frame = rtc.AudioFrame(
                data=pcm[i : i + step],
                sample_rate=SAMPLE_RATE,
                num_channels=1,
                samples_per_channel=samples_per_frame,
            )
            await source.capture_frame(frame)
        report["answers_spoken"].append({"t": round(time.monotonic() - started, 1), "text": text[:60]})

    # 3. Converse. Normal mode: wait for the agent to finish, then answer. Barge-in mode: cut in
    #    2s into the agent's utterance (max twice), then measure when its audio actually stopped.
    answer_idx = 0
    barge_ins = []
    while time.monotonic() - started < MAX_RUNTIME:
        if report["disconnected"]:
            break  # room deleted by the worker ⇒ interview closed out
        now = time.monotonic()
        barging = (
            BARGE_IN
            and len(barge_ins) < 2
            and answer_idx < len(ANSWERS)
            and now - agent_last_active["t"] < 0.4  # agent speaking right now
            and now - agent_last_active["speech_start"] > 2.0  # ...and has been for 2s
        )
        if barging:
            barge_start = now
            agent_last_active["spoke_since_answer"] = False
            await speak(ANSWERS[answer_idx])
            answer_idx += 1
            # When did the agent actually go quiet after we started talking over it?
            tail = [t for t in activity_log if barge_start <= t <= barge_start + 6.0]
            stop_latency = round(max(tail) - barge_start, 2) if tail else 0.0
            barge_ins.append({"at": round(barge_start - started, 1), "agent_stopped_after_s": stop_latency})
        elif (
            agent_last_active["spoke_since_answer"]
            and now - agent_last_active["t"] > QUIET_SECONDS
            and answer_idx < len(ANSWERS)
        ):
            agent_last_active["spoke_since_answer"] = False
            await speak(ANSWERS[answer_idx])
            answer_idx += 1
        await asyncio.sleep(0.25)
    if barge_ins:
        report["barge_ins"] = barge_ins

    if not report["disconnected"]:
        await room.disconnect()

    report["answers_count"] = answer_idx
    report["runtime_s"] = round(time.monotonic() - started, 1)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
