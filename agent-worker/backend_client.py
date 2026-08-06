"""HTTP client for the interview-portal endpoints the worker is allowed to touch.

The worker is the engine's mouth and ears — every decision (question authoring,
scoring, dialogue-act detection, guardrail verdicts, metering) lives on the Node
backend. This client is the ONLY path the worker may use to reach it, and it
carries the candidate's portal JWT (handed over via agent-dispatch metadata), so
every call lands inside the same session scoping, tenant isolation, rate limits,
and guardrail the browser-based pipelines already use. The worker never holds a
broader credential than the candidate it is speaking with.

Endpoint contracts (verified against backend/controllers/voiceAgentController.js
and livekitController.js):

  GET  /livekit/brief   -> {promptVersion, prompt, functions, keyterms, voice}
                    The interview's single source of truth, assembled by
                    voiceAgentService.sessionBrief. The worker renders it; it
                    authors nothing.
  POST /realtime/function    {name, arguments, evidence}      -> {result}
                    Engine errors come back as SPEAKABLE instructions inside the
                    200 body, never as a transport failure the agent can't voice.
  POST /realtime/transcript  {utterances: [{text, role, at}]} -> {stored, halted?, message?}
                    role "assistant" -> agentUtterances, and the guardrail runs
                    over it. role "candidate" -> candidateUtterances, the audit
                    record only: never guardrailed (the guardrail watches the
                    INTERVIEWER; pointing it at the candidate would make it
                    surveillance) and never read by any scoring path.
                    `halted: true` means the guardrail tripped a critical rule:
                    speak `message`, then end.
  POST /livekit/end          {}                               -> {metered, durationMs}
                    Idempotent metering close; the room_finished webhook is the
                    backstop for crashed workers.
"""

from __future__ import annotations

import httpx

PORTAL = "/api/interview-portal"


class BackendClient:
    def __init__(self, base_url: str, portal_token: str):
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {portal_token}"},
            timeout=httpx.Timeout(15.0, connect=5.0),
        )

    async def get_brief(self) -> dict:
        r = await self._http.get(f"{PORTAL}/livekit/brief")
        r.raise_for_status()
        return r.json()

    async def function_call(self, name: str, arguments: dict, evidence: dict | None = None) -> dict:
        r = await self._http.post(
            f"{PORTAL}/realtime/function",
            json={"name": name, "arguments": arguments, "evidence": evidence or {}},
        )
        r.raise_for_status()
        return r.json()

    async def post_transcript(self, utterances: list[dict]) -> dict:
        r = await self._http.post(f"{PORTAL}/realtime/transcript", json={"utterances": utterances})
        r.raise_for_status()
        return r.json()

    async def end(self) -> dict:
        r = await self._http.post(f"{PORTAL}/livekit/end", json={})
        r.raise_for_status()
        return r.json()

    async def aclose(self) -> None:
        await self._http.aclose()
