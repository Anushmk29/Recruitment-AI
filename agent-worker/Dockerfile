# LiveKit agent worker image. Built by `docker compose --profile agent up -d` from the
# repo root, and by the Render `recruitment-agent-worker` service (LK-5).
#
# 3.12, not latest: livekit-agents does not support Python 3.14 yet. Bump only after
# the plugin matrix (deepgram/openai/silero/turn-detector) confirms support.
FROM python:3.12-slim

WORKDIR /app

# Deps first so source edits don't bust the pip layer cache (same pattern as backend/).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Prefetch Silero VAD + turn-detector weights at BUILD time. Downloading at job time
# would add cold-start seconds to a candidate's interview pickup — never do that.
RUN python agent.py download-files

# No EXPOSE / HEALTHCHECK: the worker dials OUT to LiveKit and serves no inbound
# traffic. Liveness is observable from the LiveKit dashboard's worker registry.
CMD ["python", "agent.py", "start"]
