import { createServer, IncomingMessage, ServerResponse } from "http";
import type { BridgeConfig, SessionStore } from "./types";

export interface A2AProxyOptions {
  config: BridgeConfig;
  platformClient: {
    sendToAgent(name: string, message: string, options?: { contextId?: string; groupId?: string; rootContextId?: string }): Promise<{ response: string; status: string; error?: string }>;
    getAgentCard(name: string): Promise<any>;
    listGroups(): Promise<any[]>;
    listGroupAgents(groupID: string): Promise<any[]>;
  };
  sessionStore?: SessionStore;
}

export class A2AProxyServer {
  private server = createServer(this.handleRequest.bind(this));
  private port: number;
  private platformClient: A2AProxyOptions["platformClient"];
  private sessionStore?: SessionStore;
  private knownAgents: string[];
  private agentName: string;

  constructor(opts: A2AProxyOptions) {
    this.port = opts.config.a2a_proxy_port;
    this.platformClient = opts.platformClient;
    this.sessionStore = opts.sessionStore;
    this.knownAgents = opts.config.known_agents;
    this.agentName = opts.config.agent_name;
  }

  start() {
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(`[A2A-PROXY] listening on http://127.0.0.1:${this.port}`);
    });
  }

  stop() {
    this.server.close();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    res.setHeader("Content-Type", "application/json");

    try {
      // Legacy endpoint: list known agents from config
      if (pathname === "/a2a/agents" && req.method === "GET") {
        const cards = await Promise.all(
          this.knownAgents
            .filter((name) => name !== this.agentName)
            .map(async (name) => {
              try {
                const card = await this.platformClient.getAgentCard(name);
                return { name, available: true, card };
              } catch {
                return { name, available: false };
              }
            }),
        );
        res.writeHead(200);
        res.end(JSON.stringify({ agents: cards }));
        return;
      }

      // List groups
      if (pathname === "/a2a/groups" && req.method === "GET") {
        const groups = await this.platformClient.listGroups();
        res.writeHead(200);
        res.end(JSON.stringify({ groups }));
        return;
      }

      // List agents in a group
      if (pathname.startsWith("/a2a/groups/") && pathname.endsWith("/agents") && req.method === "GET") {
        const groupID = pathname.slice("/a2a/groups/".length, -"/agents".length);
        const agents = await this.platformClient.listGroupAgents(groupID);
        res.writeHead(200);
        res.end(JSON.stringify({ agents }));
        return;
      }

      // Send task to agent
      if (pathname === "/a2a/send" && req.method === "POST") {
        const body = await readBody(req);
        const payload = JSON.parse(body);
        const targetAgent = payload.agent as string;
        const message = payload.message as string;
        const contextId = payload.context_id as string | undefined;
        const groupId = payload.group_id as string | undefined;

        if (!targetAgent || !message) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "missing 'agent' or 'message'" }));
          return;
        }

        let rootContextId: string | undefined;
        if (contextId && this.sessionStore) {
          const stored = await this.sessionStore.getRootContextId(contextId);
          if (stored) rootContextId = stored;
        }
        const result = await this.platformClient.sendToAgent(targetAgent, message, { contextId, groupId, rootContextId });
        res.writeHead(result.status === "completed" ? 200 : 502);
        res.end(JSON.stringify(result));
        return;
      }

      // Get agent card
      if (pathname.startsWith("/a2a/agent-card/") && req.method === "GET") {
        const name = pathname.slice("/a2a/agent-card/".length);
        const card = await this.platformClient.getAgentCard(name);
        res.writeHead(200);
        res.end(JSON.stringify(card));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err: any) {
      console.error(`[A2A-PROXY] error: ${err?.message ?? err}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err?.message ?? "internal error" }));
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
