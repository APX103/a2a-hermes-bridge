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
pm2 start ecosystem.config.js
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

## Step 3: Restart Hermes

Hermes will spawn the MCP server and auto-discover 6 A2A tools.

## Step 4: Verify

Ask Hermes to run the recommended workflow:

```
mcp_a2a_bridge_a2a_list_groups
mcp_a2a_bridge_a2a_list_group_agents(group_id="default-p2p")
mcp_a2a_bridge_a2a_send_to_agent(agent="mi", message="hello", group_id="default-p2p")
```

Expected: Hermes lists groups → lists agents in default-p2p → sends message to mi → gets reply.

## Group-First Design

Unlike naive agent-to-agent calls, the A2A platform uses **groups as collaboration boundaries**:

1. `a2a_list_groups` — discover where you belong
2. `a2a_list_group_agents` — discover who is in that group
3. `a2a_send_to_agent` — send only within the group boundary

This mirrors how the platform's built-in agents work.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection refused` | Bridge not running | `pm2 start ecosystem.config.js` |
| `agent not found in group` | Target not in chosen group | Call `list_groups` then `list_group_agents` to find valid targets |
| `group_id required` | Skipped `list_groups` | Always call `list_groups` first |
| `bridge unreachable` | Bridge crashed | `pm2 logs a2a-hermes-bridge` |
| MCP tools missing | Hermes MCP not configured | Check `config.yaml` syntax |
