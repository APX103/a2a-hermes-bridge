#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, renameSync, writeFileSync } from "fs";
import { resolve } from "path";

const BRIDGE_URL = process.env.BRIDGE_URL || "http://127.0.0.1:28091";
const CONFIG_PATH = process.env.BRIDGE_CONFIG || "./config.json";

export interface ToolHandlerOptions {
  bridgeUrl?: string;
  configPath?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30000;

function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const signal = rest.signal ?? AbortSignal.timeout(timeoutMs);
  return fetchImpl(input, { ...rest, signal });
}

const TOOLS = [
  {
    name: "a2a_list_groups",
    description: "List A2A groups visible to this agent. Call this FIRST before listing agents or sending messages — all agent collaboration happens inside a group boundary.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "a2a_list_group_agents",
    description: "List agents inside a specific group. Must call a2a_list_groups first to get a valid group_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        group_id: { type: "string", description: "Group ID returned by a2a_list_groups." },
      },
      required: ["group_id"],
    },
  },
  {
    name: "a2a_get_agent_card",
    description: "Get the Agent Card (capabilities and skills) of a specific agent. Best used after a2a_list_group_agents to inspect an agent before sending a task.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Name of the A2A agent to inspect." },
      },
      required: ["agent"],
    },
  },
  {
    name: "a2a_send_to_agent",
    description: "Send a task to another A2A agent inside a group and wait for its response. Call a2a_list_groups then a2a_list_group_agents first; pass group_id to stay within the collaboration boundary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Name of the target A2A agent." },
        message: { type: "string", description: "The task message to send." },
        group_id: { type: "string", description: "Group ID that authorizes this agent-to-agent interaction." },
        context_id: { type: "string", description: "Optional context ID for multi-turn continuity." },
      },
      required: ["agent", "message", "group_id"],
    },
  },
  {
    name: "a2a_bridge_status",
    description: "Check whether the A2A bridge proxy is online and reachable.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "a2a_update_known_agents",
    description: "Update the bridge's known_agents list in config.json. Restart bridge to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agents: { type: "array", items: { type: "string" }, description: "List of agent names the bridge should know about." },
      },
      required: ["agents"],
    },
  },
];

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  options: ToolHandlerOptions = {},
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const bridgeUrl = options.bridgeUrl ?? BRIDGE_URL;
  const configPath = options.configPath ?? CONFIG_PATH;
  const _fetch = options.fetchImpl ?? fetch;

  if (name === "a2a_list_groups") {
    try {
      const res = await fetchWithTimeout(`${bridgeUrl}/a2a/groups`, { timeoutMs: 10000 }, _fetch);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { groups?: Array<{ id?: string; ID?: string; name?: string; orchestration_mode?: string; mode?: string; status?: string }> };
      const groups = data.groups ?? [];
      if (!groups.length) return { content: [{ type: "text", text: "No groups found." }] };
      const lines = groups.map((g) => {
        const id = g.id ?? g.ID ?? "?";
        const name = g.name ?? "Unnamed";
        const mode = g.orchestration_mode ?? g.mode ?? "unknown";
        const status = g.status ?? "unknown";
        return `  - ${name} (id: ${id}, mode: ${mode}, status: ${status})`;
      });
      return { content: [{ type: "text", text: `Found ${groups.length} groups:\n${lines.join("\n")}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  if (name === "a2a_list_group_agents") {
    const groupID = String(args.group_id ?? "");
    if (!groupID) return { content: [{ type: "text", text: "group_id is required" }], isError: true };
    try {
      const res = await fetchWithTimeout(
        `${bridgeUrl}/a2a/groups/${encodeURIComponent(groupID)}/agents`,
        { timeoutMs: 10000 },
        _fetch,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { agents?: Array<{ name?: string; role?: string; card?: { skills?: Array<{ name?: string; id?: string }> } }> };
      const agents = data.agents ?? [];
      if (!agents.length) return { content: [{ type: "text", text: `No agents found in group ${groupID}.` }] };
      const lines = agents.map((a) => {
        const skills = (a.card?.skills ?? []).map((s) => s.name || s.id || "?").join(", ");
        return `  - ${a.name ?? "?"}${a.role ? ` (role: ${a.role})` : ""}${skills ? ` — skills: ${skills}` : ""}`;
      });
      return { content: [{ type: "text", text: `Agents in group ${groupID}:\n${lines.join("\n")}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  if (name === "a2a_get_agent_card") {
    const agent = String(args.agent ?? "");
    if (!agent) return { content: [{ type: "text", text: "agent is required" }], isError: true };
    try {
      const res = await fetchWithTimeout(
        `${bridgeUrl}/a2a/agent-card/${encodeURIComponent(agent)}`,
        { timeoutMs: 10000 },
        _fetch,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const card = await res.json() as {
        name?: string;
        description?: string;
        skills?: Array<{ name?: string; id?: string }>;
        capabilities?: { streaming?: boolean };
      };
      const skills = (card.skills ?? []).map((s) => s.name || s.id || "?").join(", ");
      const caps = card.capabilities ?? {};
      const text =
        `Agent: ${card.name || agent}\n` +
        `Description: ${card.description || "N/A"}\n` +
        `Skills: ${skills}\n` +
        `Streaming: ${caps.streaming ?? false}`;
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  if (name === "a2a_send_to_agent") {
    const targetAgent = String(args.agent ?? "");
    const message = String(args.message ?? "");
    const groupID = String(args.group_id ?? "");
    const contextId = args.context_id as string | undefined;
    if (!targetAgent || !message || !groupID) {
      return { content: [{ type: "text", text: "agent, message, and group_id are all required" }], isError: true };
    }
    try {
      const payload: Record<string, string> = { agent: targetAgent, message, group_id: groupID };
      if (contextId) payload.context_id = contextId;
      const res = await fetchWithTimeout(
        `${bridgeUrl}/a2a/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          timeoutMs: 120000,
        },
        _fetch,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
      const data = await res.json() as { status?: string; error?: string; response?: string };
      if (data.status !== "completed") {
        return { content: [{ type: "text", text: `Task failed: ${data.error || data.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: data.response || "" }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  if (name === "a2a_bridge_status") {
    try {
      const res = await fetchWithTimeout(`${bridgeUrl}/a2a/groups`, { timeoutMs: 5000 }, _fetch);
      return {
        content: [{ type: "text", text: res.ok ? "Bridge is online." : `Bridge returned HTTP ${res.status}.` }],
        isError: !res.ok,
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Bridge unreachable: ${err.message}` }], isError: true };
    }
  }

  if (name === "a2a_update_known_agents") {
    try {
      const agents = args.agents;
      if (!Array.isArray(agents) || !agents.every((a) => typeof a === "string")) {
        return { content: [{ type: "text", text: "agents must be an array of strings" }], isError: true };
      }
      const path = resolve(configPath);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      raw.known_agents = agents;
      const tmpPath = `${path}.tmp.${Date.now()}`;
      writeFileSync(tmpPath, JSON.stringify(raw, null, 2) + "\n");
      renameSync(tmpPath, path);
      return { content: [{ type: "text", text: `Updated known_agents to: ${agents.join(", ")}. Restart bridge to apply.` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

const server = new Server(
  { name: "a2a-bridge-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleToolCall(request.params.name, request.params.arguments ?? {});
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[MCP] fatal error:", err);
  process.exit(1);
});
