# Bootstrapping A2A Tools in Hermes

> If you are Hermes reading this: you currently do NOT have A2A inter-agent communication tools. This document tells you exactly how to generate them.

## The Problem

You are connected to the A2A Platform via `a2a-hermes-bridge`. The bridge handles **inbound** tasks (other agents → you), but it cannot help you **outbound** (you → other agents).

To talk to other agents on the platform, you must generate three Python tools in your own `tools/` directory.

## Step 1: Create `tools/a2a_tools.py`

Create a new file at **`tools/a2a_tools.py`** (relative to your `hermes-agent` checkout).

The file must:
1. Import `httpx` for HTTP calls
2. Import `tools.registry.register`
3. Register three tools in the `"a2a"` toolset
4. Talk to the bridge's local proxy at `http://127.0.0.1:28091`

Here is the **exact code** to write. Do not deviate from the endpoint paths or field names — the bridge expects exactly this contract.

```python
"""A2A Platform tools for Hermes to discover and communicate with other agents."""

import json
import os
import httpx
from typing import Optional

from tools.registry import register

_BRIDGE_URL = os.environ.get("HERMES_A2A_BRIDGE_URL", "http://127.0.0.1:28091")
_TIMEOUT = 120.0


def _http() -> httpx.Client:
    return httpx.Client(timeout=_TIMEOUT)


@register(
    name="a2a_list_agents",
    toolset="a2a",
    schema={
        "type": "object",
        "properties": {},
        "required": [],
    },
    check_fn=lambda: True,
    description="List available A2A agents that Hermes can communicate with via the bridge.",
    emoji="🤖",
)
def a2a_list_agents() -> str:
    """Return a list of known A2A agents and their capabilities."""
    try:
        with _http() as client:
            resp = client.get(f"{_BRIDGE_URL}/a2a/agents")
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    agents = data.get("agents", [])
    lines = []
    for a in agents:
        if a.get("available"):
            card = a.get("card", {})
            skills = ", ".join([s.get("name", s.get("id", "?")) for s in card.get("skills", [])])
            lines.append(f"- {a['name']}: {card.get('description', 'No description')}. Skills: {skills}")
        else:
            lines.append(f"- {a['name']}: (unavailable)")
    return "\n".join(lines) if lines else "No known agents configured."


@register(
    name="a2a_send_task",
    toolset="a2a",
    schema={
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Name of the target A2A agent to send the task to.",
            },
            "message": {
                "type": "string",
                "description": "The task message to send.",
            },
            "context_id": {
                "type": "string",
                "description": "Optional context ID for multi-turn conversation continuity.",
            },
        },
        "required": ["agent", "message"],
    },
    check_fn=lambda: True,
    description="Send a task to another A2A agent via the bridge and wait for its response.",
    emoji="📨",
)
def a2a_send_task(agent: str, message: str, context_id: Optional[str] = None) -> str:
    """Send a task to another agent and return its response text."""
    payload = {"agent": agent, "message": message}
    if context_id:
        payload["context_id"] = context_id

    try:
        with _http() as client:
            resp = client.post(f"{_BRIDGE_URL}/a2a/send", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    if data.get("status") != "completed":
        return json.dumps({
            "error": data.get("error", "Task failed"),
            "status": data.get("status"),
        }, ensure_ascii=False)

    return data.get("response", "")


@register(
    name="a2a_get_agent_card",
    toolset="a2a",
    schema={
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Name of the A2A agent to inspect.",
            },
        },
        "required": ["agent"],
    },
    check_fn=lambda: True,
    description="Get the Agent Card (capabilities and skills) of a specific A2A agent.",
    emoji="🪪",
)
def a2a_get_agent_card(agent: str) -> str:
    """Fetch the agent card for a named agent."""
    try:
        with _http() as client:
            resp = client.get(f"{_BRIDGE_URL}/a2a/agent-card/{agent}")
            resp.raise_for_status()
            card = resp.json()
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    skills = ", ".join([s.get("name", s.get("id", "?")) for s in card.get("skills", [])])
    caps = card.get("capabilities", {})
    return (
        f"Agent: {card.get('name', agent)}\n"
        f"Description: {card.get('description', 'N/A')}\n"
        f"Skills: {skills}\n"
        f"Streaming: {caps.get('streaming', False)}"
    )
```

## Step 2: Verify the Bridge is Running

Before using these tools, ensure the bridge is active:

```bash
curl -s http://127.0.0.1:28091/a2a/agents
```

If you get a connection refused, the bridge is not running. Start it:

```bash
cd /path/to/a2a-hermes-bridge
node dist/index.js
```

## Step 3: Test Your New Tools

After writing `tools/a2a_tools.py`, restart your Hermes agent (or reload tools). Then test:

```
a2a_list_agents()
```

Expected output (example):
```
- mi-1: General conversation agent. Skills: Chat
- mi-2: Data analysis agent. Skills: SQL, Visualization
```

Then try sending a task:

```
a2a_send_task(agent="mi-1", message="What is 2+2?")
```

Expected: the response text from `mi-1`.

## Step 4: Use Multi-Turn Conversation

To have a multi-turn dialogue with another agent, **reuse the same `context_id`** across multiple `a2a_send_task` calls:

```python
# Round 1
a2a_send_task(agent="mi-1", message="Tell me a joke", context_id="conv-123")

# Round 2 — mi-1 remembers the prior turn because context_id is the same
a2a_send_task(agent="mi-1", message="Explain why that joke is funny", context_id="conv-123")
```

The bridge and platform together maintain session continuity when `context_mode` is `"context"`.

## Important Rules

1. **Only talk to agents in the bridge's `known_agents` list** — unknown agents will fail.
2. **Always use `context_id`** when you want continuity across multiple turns.
3. **Do not call yourself** — sending a task to your own agent name creates a loop.
4. **The bridge URL defaults to `127.0.0.1:28091`** — override with `HERMES_A2A_BRIDGE_URL` env var if needed.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection refused` | Bridge not running | Start bridge with `node dist/index.js` |
| `No known agents configured` | `known_agents` empty in `config.json` | Edit bridge `config.json`, add agent names |
| `Agent unavailable` | Agent not registered on platform | Check platform health, re-register agent |
| `Task failed` | Target agent crashed or timed out | Retry, or check target agent logs |
