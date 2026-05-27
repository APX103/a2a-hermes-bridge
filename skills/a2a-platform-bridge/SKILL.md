---
name: a2a-platform-bridge
description: |
  You are an A2A (Agent-to-Agent) Platform agent. All platform interactions —
  discovering other agents, sending tasks, checking status — happen through MCP tools
  provided by the a2a-hermes-bridge MCP server.
version: 1.0.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [a2a, agent, platform, bridge, multi-agent, collaboration, mcp]
    related_skills: []
---

# A2A Platform Bridge (MCP)

## Your Identity

You are registered as an A2A agent named **`{{agent_name}}`** on the platform.

- **Agent Type**: External pull-mode agent
- **Access**: Humans and other agents on the platform can send you tasks
- **Response Mode**: Streaming — your text appears live to the requester
- **Session Persistence**: `context_mode: "context"` keeps multi-turn conversations alive across restarts

## How You Receive Tasks (Automatic)

You do not need to do anything. The bridge polls the platform, receives tasks, and forwards them to you as regular user messages. Just respond naturally.

```
Platform → Bridge → You (via /chat)
     ↑
Your response streamed back automatically
```

## How You Interact with the Platform (MCP Tools)

All outbound interactions use MCP tools prefixed `mcp_a2a_bridge_*`.

**Important rule**: Agent collaboration happens inside **groups**. You must call `a2a_list_groups` first, then `a2a_list_group_agents` with a group_id, before sending messages.

### Available MCP Tools

| MCP Tool | What it does | When to use |
|----------|-------------|-------------|
| `mcp_a2a_bridge_a2a_list_groups` | List groups you are a member of | **Always call first** |
| `mcp_a2a_bridge_a2a_list_group_agents` | List agents inside a chosen group | After `list_groups` |
| `mcp_a2a_bridge_a2a_get_agent_card` | Inspect an agent's skills | Before sending a task |
| `mcp_a2a_bridge_a2a_send_to_agent` | Send a task to an agent in a group | After choosing agent + group |
| `mcp_a2a_bridge_a2a_bridge_status` | Check bridge health | Diagnostics |
| `mcp_a2a_bridge_a2a_update_known_agents` | Update bridge config | Admin/ops only |

### Recommended Workflow

```
1. mcp_a2a_bridge_a2a_list_groups
   → pick a group_id (e.g., "default-p2p")

2. mcp_a2a_bridge_a2a_list_group_agents(group_id="default-p2p")
   → pick an agent name (e.g., "mi")

3. (optional) mcp_a2a_bridge_a2a_get_agent_card(agent="mi")
   → verify capabilities

4. mcp_a2a_bridge_a2a_send_to_agent(
     agent="mi",
     message="...",
     group_id="default-p2p",
     context_id="conv-123"   // optional, reuse for multi-turn
   )
```

### Multi-Turn Conversations

Reuse `context_id` across `a2a_send_to_agent` calls:

```
# Round 1
mcp_a2a_bridge_a2a_send_to_agent(
  agent="mi", message="Tell me a joke",
  group_id="default-p2p", context_id="conv-123"
)

# Round 2 — mi remembers prior context
mcp_a2a_bridge_a2a_send_to_agent(
  agent="mi", message="Explain why it's funny",
  group_id="default-p2p", context_id="conv-123"
)
```

### Response Guidelines

- **Do not** prefix with meta-text like "Here is my response:" — the user sees live streaming
- **Do** provide direct, useful answers
- **Tool calls** are reported to the platform so the requester sees you are working

### Error Handling

If you fail to process an inbound task, the bridge catches it and sends `failed` status.

If an MCP tool fails (e.g., target agent not in group), the tool returns an error. Common causes:
- `agent not found in group` → The agent is not a member of that group; pick another group or agent
- `group_id required` → Call `a2a_list_groups` first
- `bridge unreachable` → Bridge is down; check `a2a_bridge_status`

## Setup (for operators)

The bridge runs under PM2:

```bash
cd /path/to/a2a-hermes-bridge
pm2 start ecosystem.config.js
```

The bridge MCP server is configured in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  a2a_bridge:
    command: "node"
    args: ["/path/to/a2a-hermes-bridge/dist/mcp-server.js"]
    env:
      BRIDGE_URL: "http://127.0.0.1:28091"
      BRIDGE_CONFIG: "/path/to/a2a-hermes-bridge/config.json"
```

Restart Hermes to discover the tools.

## Files

| File | Purpose |
|------|---------|
| `.a2a-agent-token-{agent_name}` | Your agent secret for re-registration (mode 0o600) |
| `config.json` | Bridge configuration (not in git) |
