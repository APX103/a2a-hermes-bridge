#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const BRIDGE_URL = process.env.BRIDGE_URL || "http://127.0.0.1:28091";
const CONFIG_PATH = process.env.BRIDGE_CONFIG || "./config.json";

const server = new Server(
  { name: "a2a-bridge-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "a2a_list_agents",
    description: "List available A2A agents that can be communicated with via the bridge.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "a2a_send_task",
    description: "Send a task to another A2A agent via the bridge and wait for its response.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Name of the target A2A agent." },
        message: { type: "string", description: "The task message to send." },
        context_id: { type: "string", description: "Optional context ID for multi-turn continuity." },
      },
      required: ["agent", "message"],
    },
  },
  {
    name: "a2a_get_agent_card",
    description: "Get the Agent Card (capabilities and skills) of a specific A2A agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Name of the A2A agent to inspect." },
      },
      required: ["agent"],
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

  if (name === "a2a_list_agents") {
    const res = await fetch(`${BRIDGE_URL}/a2a/agents`);
    if (!res.ok) return { content: [{ type: "text", text: `Error: HTTP ${res.status}` }], isError: true };
    const data: any = await res.json();
    const lines: string[] = [];
    for (const a of data.agents ?? []) {
      if (a.available) {
        const card = a.card ?? {};
        const skills = (card.skills ?? []).map((s: any) => s.name || s.id || "?").join(", ");
        lines.push(`- ${a.name}: ${card.description || "No description"}. Skills: ${skills}`);
      } else {
        lines.push(`- ${a.name}: (unavailable)`);
      }
    }
    return { content: [{ type: "text", text: lines.length ? lines.join("\n") : "No known agents configured." }] };
  }

  if (name === "a2a_send_task") {
    const payload: any = { agent: args.agent, message: args.message };
    if (args.context_id) payload.context_id = args.context_id;
    const res = await fetch(`${BRIDGE_URL}/a2a/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { content: [{ type: "text", text: `Error: HTTP ${res.status}` }], isError: true };
    const data: any = await res.json();
    if (data.status !== "completed") {
      return { content: [{ type: "text", text: `Task failed: ${data.error || data.status}` }], isError: true };
    }
    return { content: [{ type: "text", text: data.response || "" }] };
  }

  if (name === "a2a_get_agent_card") {
    const res = await fetch(`${BRIDGE_URL}/a2a/agent-card/${encodeURIComponent(String(args.agent))}`);
    if (!res.ok) return { content: [{ type: "text", text: `Error: HTTP ${res.status}` }], isError: true };
    const card: any = await res.json();
    const skills = (card.skills ?? []).map((s: any) => s.name || s.id || "?").join(", ");
    const caps = card.capabilities ?? {};
    const text =
      `Agent: ${card.name || args.agent}\n` +
      `Description: ${card.description || "N/A"}\n` +
      `Skills: ${skills}\n` +
      `Streaming: ${caps.streaming ?? false}`;
    return { content: [{ type: "text", text }] };
  }

  if (name === "a2a_bridge_status") {
    try {
      const res = await fetch(`${BRIDGE_URL}/a2a/agents`, { signal: AbortSignal.timeout(5000) });
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
