"""LK-0 gate probe — joins a room as a fake candidate and reports what the agent does.

Automates the observable half of the LK-0 acceptance gate: with `agent.py dev` running,
this connects to a fresh room, waits, and reports whether the worker (auto-dispatch mode)
joined, published audio (the Aura greeting), and emitted caption text. The half it cannot
automate — hearing the greeting with human ears and speaking back — stays a manual step
on the gate.

Usage:  .venv/Scripts/python probe_room.py        (prints a JSON verdict)
"""

import asyncio
import json
import os
import time

from dotenv import load_dotenv

load_dotenv()

from livekit import api, rtc  # noqa: E402

LISTEN_SECONDS = 25


async def main():
    room_name = f"lk0-smoke-{int(time.time())}"
    token = (
        api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity("probe-candidate")
        .with_grants(api.VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True))
        .to_jwt()
    )

    room = rtc.Room()
    results = {
        "room": room_name,
        "agent_joined": False,
        "agent_identity": None,
        "agent_audio_track": False,
        "audio_frames": 0,
        "captions": [],
    }

    def note_participant(p):
        results["agent_joined"] = True
        results["agent_identity"] = p.identity

    @room.on("participant_connected")
    def on_participant(p):
        note_participant(p)

    async def read_audio(track):
        stream = rtc.AudioStream(track)
        async for _event in stream:
            results["audio_frames"] += 1
            if results["audio_frames"] >= 300:  # plenty to prove the greeting played
                break

    @room.on("track_subscribed")
    def on_track(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            results["agent_audio_track"] = True
            asyncio.ensure_future(read_audio(track))

    # Agents ≥1.x publish captions over the lk.transcription text stream; older paths used
    # transcription events. Listen to both — the probe cares that captions exist at all.
    def on_text(reader, participant_identity):
        async def consume():
            text = await reader.read_all()
            if text.strip():
                results["captions"].append(text.strip())

        asyncio.ensure_future(consume())

    try:
        room.register_text_stream_handler("lk.transcription", on_text)
    except Exception:
        pass

    @room.on("transcription_received")
    def on_transcription(segments, participant, publication):
        for seg in segments:
            if getattr(seg, "final", False) and seg.text.strip():
                results["captions"].append(seg.text.strip())

    await room.connect(os.environ["LIVEKIT_URL"], token)
    for p in room.remote_participants.values():  # in case the agent beat us into the room
        note_participant(p)

    await asyncio.sleep(LISTEN_SECONDS)
    await room.disconnect()

    results["verdict"] = {
        "dispatch_and_join": bool(results["agent_joined"]),
        "tts_audio_flowing": results["audio_frames"] > 0,
        "captions_flowing": len(results["captions"]) > 0,
    }
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
