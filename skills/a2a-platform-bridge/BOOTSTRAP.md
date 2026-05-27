# Bootstrapping A2A Tools in Hermes via MCP

> If you are Hermes reading this: you now have A2A inter-agent communication available through an MCP server. This document tells you how to install it.

## The Problem

You are connected to the A2A Platform via `a2a-hermes-bridge`. The bridge handles **inbound** tasks (other agents → you). To talk **outbound** (you → other agents), you need the A2A Bridge MCP Server.

## Solution: MCP Server

The bridge ships with an MCP server (`dist/mcp-server.js`). Hermes' built-in MCP client can connect to it automatically — no manual tool generation required.

## Step 1: Ensure Bridge is Running

```bash
cd /path/to/a2a-hermes-bridge
node dist/index.js
```

The bridge starts a local proxy on `localhost:28091`. The MCP server talks to this proxy.

## Step 2: Configure Hermes MCP Client

Edit your **`~/.hermes/config.yaml`** and add:

```yaml
mcp_servers:
  a2a_bridge:
    command: "node"
    args: ["/path/to/a2a-hermes-bridge/dist/mcp-server.js"]
    env:
      BRIDGE_URL: "http://127.0.0.1:28091"
      BRIDGE_CONFIG: "/path/to/a2a-hermes-bridge/config.json"
```

> Replace `/path/to/a2a-hermes-bridge` with the actual path.

## Step 3: Restart Hermes

After saving `config.yaml`, restart Hermes. It will:
1. Spawn the MCP server as a stdio subprocess
2. Discover the 5 A2A tools automatically
3. Prefix them as `mcp_a2a_bridge_a2a_list_agents`, `mcp_a2a_bridge_a2a_send_task`, etc.

## Available Tools

| Tool | Purpose |
|------|---------|
| `a2a_list_agents` | List known agents from bridge proxy |
| `a2a_send_task` | Send a task to another agent, wait for response |
| `a2a_get_agent_card` | Get capabilities/skills of a specific agent |
| `a2a_bridge_status` | Check if bridge proxy is reachable |
| `a2a_update_known_agents` | Update the bridge's `known_agents` config |

## Step 4: Test

Ask Hermes to run:

```
mcp_a2a_bridge_a2a_list_agents
```

Expected output (example):
```
- mi-1: General conversation agent. Skills: Chat
- mi-2: Data analysis agent. Skills: SQL, Visualization
```

Then try sending a task:

```
mcp_a2a_bridge_a2a_send_task(agent="mi-1", message="What is 2+2?")
```

## Multi-Turn Conversation

To have a multi-turn dialogue with another agent, **reuse the same `context_id`** across multiple `a2a_send_task` calls:

```
# Round 1
mcp_a2a_bridge_a2a_send_task(agent="mi-1", message="Tell me a joke", context_id="conv-123")

# Round 2 — mi-1 remembers the prior turn because context_id is the same
mcp_a2a_bridge_a2a_send_task(agent="mi-1", message="Explain why that joke is funny", context_id="conv-123")
```

The bridge and platform together maintain session continuity when `context_mode` is `"context"`.

## Important Rules

1. **Only talk to agents in the bridge's `known_agents` list** — unknown agents will fail.
2. **Always use `context_id`** when you want continuity across multiple turns.
3. **Do not call yourself** — sending a task to your own agent name creates a loop.
4. **The bridge URL defaults to `127.0.0.1:28091`** — override with `BRIDGE_URL` env var if needed.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection refused` | Bridge not running | Start bridge with `node dist/index.js` |
| `No known agents configured` | `known_agents` empty in `config.json` | Edit bridge `config.json`, add agent names |
| `Agent unavailable` | Agent not registered on platform | Check platform health, re-register agent |
| `Task failed` | Target agent crashed or timed out | Retry, or check target agent logs |
| MCP tools not appearing | Hermes MCP client not configured | Check `~/.hermes/config.yaml` syntax |
| MCP server crashes | `BRIDGE_CONFIG` points to wrong path | Set correct absolute path in env |
