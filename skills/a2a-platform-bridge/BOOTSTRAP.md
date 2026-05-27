# A2A Bridge MCP Setup Guide

## Goal

Connect Hermes to the A2A Platform through the bridge's MCP server. All platform interactions (inbound and outbound) flow through this single integration.

## Architecture

```
Hermes (MCP client, stdio)
    ↓
Bridge MCP Server (dist/mcp-server.js)
    ↓ HTTP
Bridge Local Proxy (localhost:28091)
    ↓ HTTP
A2A Platform (localhost:28090)
```

## Step 1: Start the Bridge

```bash
cd /path/to/a2a-hermes-bridge
node dist/index.js
```

You should see:
```
[A2A-PROXY] listening on http://127.0.0.1:28091
[OK] Registered: hermes
```

## Step 2: Configure Hermes MCP Client

Edit **`~/.hermes/config.yaml`**:

```yaml
mcp_servers:
  a2a_bridge:
    command: "node"
    args: ["/path/to/a2a-hermes-bridge/dist/mcp-server.js"]
    env:
      BRIDGE_URL: "http://127.0.0.1:28091"
      BRIDGE_CONFIG: "/path/to/a2a-hermes-bridge/config.json"
```

Replace `/path/to/a2a-hermes-bridge` with the actual absolute path.

## Step 3: Restart Hermes

Hermes will:
1. Spawn the MCP server as a stdio subprocess
2. Auto-discover 5 A2A tools
3. Prefix them as `mcp_a2a_bridge_*`

## Step 4: Verify

Ask Hermes to run:

```
mcp_a2a_bridge_a2a_list_agents
```

Expected output (example):
```
- mi-1: General conversation agent. Skills: Chat
- mi-2: Data analysis agent. Skills: SQL, Visualization
```

Test sending a task:

```
mcp_a2a_bridge_a2a_send_task(agent="mi-1", message="What is 2+2?")
```

## Multi-Turn Conversations

Reuse `context_id` across calls:

```
mcp_a2a_bridge_a2a_send_task(agent="mi-1", message="Tell me a joke", context_id="conv-123")
mcp_a2a_bridge_a2a_send_task(agent="mi-1", message="Explain why it's funny", context_id="conv-123")
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection refused` | Bridge not running | `node dist/index.js` |
| `No known agents` | `known_agents` empty | Edit `config.json`, restart bridge |
| `Agent unavailable` | Agent not on platform | Check platform, re-register target agent |
| `Task failed` | Target agent crashed | Retry or check target logs |
| MCP tools missing | Hermes MCP not configured | Check `config.yaml` syntax, restart Hermes |
| MCP server crashes | Wrong `BRIDGE_CONFIG` path | Use absolute path |
