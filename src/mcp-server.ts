#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const BRIDGE_URL = process.env.BRIDGE_URL || "http://127.0.0.1:28091";
const CONFIG_PATH = process.env.BRIDGE_CONFIG || "./config.json";
const AGENT_NAME = process.env.AGENT_NAME || "hermes";

const server = new Server(
  { name: "a2a-bridge-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

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

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  if (name === "a2a_list_groups") {
    try {
      const res = await fetch(`${BRIDGE_URL}/a2a/groups`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any = await res.json();
      const groups = data.groups ?? [];
      if (!groups.length) return { content: [{ type: "text", text: "No groups found." }] };
      const lines = groups.map((g: any) => {
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
      const res = await fetch(`${BRIDGE_URL}/a2a/groups/${encodeURIComponent(groupID)}/agents`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any = await res.json();
      const agents = data.agents ?? [];
      if (!agents.length) return { content: [{ type: "text", text: `No agents found in group ${groupID}.` }] };
      const lines = agents.map((a: any) => {
        const skills = (a.card?.skills ?? []).map((s: any) => s.name || s.id || "?").join(", ");
        return `  - ${a.name}${a.role ? ` (role: ${a.role})` : ""}${skills ? ` — skills: ${skills}` : ""}`;
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
      const res = await fetch(`${BRIDGE_URL}/a2a/agent-card/${encodeURIComponent(agent)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const card: any = await res.json();
      const skills = (card.skills ?? []).map((s: any) => s.name || s.id || "?").join(", ");
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
      const payload: any = { agent: targetAgent, message, group_id: groupID };
      if (contextId) payload.context_id = contextId;
      const res = await fetch(`${BRIDGE_URL}/a2a/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
      const data: any = await res.json();
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
      const res = await fetch(`${BRIDGE_URL}/a2a/groups`, { signal: AbortSignal.timeout(5000) });
      return { content: [{ type: "text", text: res.ok ? "Bridge is online." : `Bridge returned HTTP ${res.status}.` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Bridge unreachable: ${err.message}` }], isError: true };
    }
  }

  if (name === "a2a_update_known_agents") {
    try {
      const agents = args.agents as string[];
      const path = resolve(CONFIG_PATH);
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      raw.known_agents = agents;
      writeFileSync(path, JSON.stringify(raw, null, 2) + "\n");
      return { content: [{ type: "text", text: `Updated known_agents to: ${agents.join(", ")}. Restart bridge to apply.` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[MCP] fatal error:", err);
  process.exit(1);
});
