import { createServer, IncomingMessage, ServerResponse } from "http";
import type { BridgeConfig, SessionStore } from "./types";

export interface HealthStatus {
  targetOk: boolean;
  targetError?: string;
  pollerRunning: boolean;
}

export interface A2AProxyOptions {
  config: BridgeConfig;
  platformClient: {
    sendToAgent(name: string, message: string, options?: { contextId?: string; groupId?: string; rootContextId?: string }): Promise<{ response: string; status: string; error?: string }>;
    getAgentCard(name: string): Promise<any>;
    listGroups(): Promise<any[]>;
    listGroupAgents(groupID: string): Promise<any[]>;
  };
  sessionStore?: SessionStore;
  getHealthStatus?: () => HealthStatus;
}

export class A2AProxyServer {
  private server = createServer(this.handleRequest.bind(this));
  private port: number;
  private platformClient: A2AProxyOptions["platformClient"];
  private sessionStore?: SessionStore;
  private knownAgents: string[];
  private agentName: string;
  private getHealthStatus?: () => HealthStatus;

  constructor(opts: A2AProxyOptions) {
    this.port = opts.config.a2a_proxy_port;
    this.platformClient = opts.platformClient;
    this.sessionStore = opts.sessionStore;
    this.knownAgents = opts.config.known_agents;
    this.agentName = opts.config.agent_name;
    this.getHealthStatus = opts.getHealthStatus;
  }

  start() {
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(`[A2A-PROXY] listening on http://127.0.0.1:${this.port}`);
    });
    // Self-check: verify platform connectivity shortly after startup
    setTimeout(() => {
      this.platformClient.listGroups().then(() => {
        console.log("[A2A-PROXY] platform connection OK");
      }).catch((err: any) => {
        console.warn(`[A2A-PROXY] platform check failed: ${err?.message ?? err}`);
      });
    }, 1000);
  }

  stop() {
    this.server.close();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathname = url.pathname;

    res.setHeader("Content-Type", "application/json");

    try {
      // Health check
      if (pathname === "/health" && req.method === "GET") {
        const health = this.getHealthStatus ? this.getHealthStatus() : { targetOk: true, pollerRunning: true };
        const ok = health.targetOk;
        res.writeHead(ok ? 200 : 503);
        res.end(JSON.stringify({
          status: ok ? "ok" : "degraded",
          bridge: "running",
          target: ok ? "connected" : (health.targetError ?? "unreachable"),
          poller: health.pollerRunning ? "running" : "paused",
          timestamp: new Date().toISOString(),
        }));
        return;
      }

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

function readBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    const timeout = setTimeout(() => reject(new Error("read body timeout")), 10000);
    req.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        clearTimeout(timeout);
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => { clearTimeout(timeout); resolve(body); });
    req.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}
