import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { A2AProxyServer } from "../src/a2a-proxy";
import type { BridgeConfig, SessionStore } from "../src/types";

function makeConfig(): BridgeConfig {
  return {
    agent_name: "test-agent",
    agent_description: "test",
    agent_version: "1.0.0",
    platform_url: "http://localhost:9999",
    hermes_url: "http://localhost:8888",
    hermes_api_key: "",
    hermes_model: "test",
    hermes_timeout_ms: 5000,
    context_mode: "stateless",
    pull: { poll_interval_ms: 100, poll_batch_size: 5, heartbeat_interval_ms: 1000, max_workers: 2 },
    session_store: { type: "memory", path: "" },
    a2a_proxy_port: 0, // let OS assign port
    known_agents: ["agent-a", "agent-b"],
    agent_card: { skills: [], capabilities: { streaming: true } },
  };
}

function mockPlatformClient() {
  return {
    sendToAgent: async (_name: string, _message: string, _opts?: any) => ({ response: "ok", status: "completed" }),
    getAgentCard: async (_name: string) => ({ name: "agent-a", description: "desc", skills: [{ id: "s1", name: "Skill1" }], capabilities: { streaming: true } }),
    listGroups: async () => [{ id: "g1", name: "Group1", mode: "p2p", status: "active" }],
    listGroupAgents: async (_groupID: string) => [{ name: "agent-a", role: "worker", card: { skills: [{ id: "s1", name: "Skill1" }] } }],
  };
}

function httpRequest(port: number, path: string, opts?: { method?: string; body?: string }): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = require("http").request({ hostname: "127.0.0.1", port, path, method: opts?.method ?? "GET", headers: opts?.body ? { "Content-Type": "application/json" } : {} }, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on("error", reject);
    if (opts?.body) req.write(opts.body);
    req.end();
  });
}

describe("A2AProxyServer", () => {
  let proxy: A2AProxyServer;
  let port: number;

  beforeEach(async () => {
    const config = makeConfig();
    proxy = new A2AProxyServer({ config, platformClient: mockPlatformClient() });
    proxy.start();
    // Wait for server to start and grab assigned port
    await new Promise((r) => setTimeout(r, 100));
    const addr = (proxy as any).server.address();
    port = addr.port;
  });

  afterEach(() => {
    proxy.stop();
  });

  it("should list groups", async () => {
    const res = await httpRequest(port, "/a2a/groups");
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].id).toBe("g1");
  });

  it("should list agents in a group", async () => {
    const res = await httpRequest(port, "/a2a/groups/g1/agents");
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].name).toBe("agent-a");
  });

  it("should get agent card", async () => {
    const res = await httpRequest(port, "/a2a/agent-card/agent-a");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("agent-a");
  });

  it("should send task to agent", async () => {
    const res = await httpRequest(port, "/a2a/send", {
      method: "POST",
      body: JSON.stringify({ agent: "agent-a", message: "hello", group_id: "g1" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe("ok");
    expect(res.body.status).toBe("completed");
  });

  it("should return 400 when send payload is missing fields", async () => {
    const res = await httpRequest(port, "/a2a/send", {
      method: "POST",
      body: JSON.stringify({ agent: "agent-a" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("missing");
  });

  it("should return 404 for unknown routes", async () => {
    const res = await httpRequest(port, "/a2a/unknown");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not found");
  });

  it("should return health status", async () => {
    const config = makeConfig();
    const p = new A2AProxyServer({
      config,
      platformClient: mockPlatformClient(),
      getHealthStatus: () => ({ targetOk: true, pollerRunning: true }),
    });
    p.start();
    await new Promise((r) => setTimeout(r, 100));
    const assignedPort = (p as any).server.address().port;

    const res = await httpRequest(assignedPort, "/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.bridge).toBe("running");
    expect(res.body.target).toBe("connected");
    expect(res.body.poller).toBe("running");
    expect(res.body.timestamp).toBeTruthy();
    p.stop();
  });

  it("should return degraded health when target is down", async () => {
    const config = makeConfig();
    const p = new A2AProxyServer({
      config,
      platformClient: mockPlatformClient(),
      getHealthStatus: () => ({ targetOk: false, targetError: "Hermes down", pollerRunning: false }),
    });
    p.start();
    await new Promise((r) => setTimeout(r, 100));
    const assignedPort = (p as any).server.address().port;

    const res = await httpRequest(assignedPort, "/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.target).toBe("Hermes down");
    expect(res.body.poller).toBe("paused");
    p.stop();
  });

  it("should propagate rootContextId from session store", async () => {
    const sessionStore: SessionStore = {
      getOrCreateSession: async () => "sess-1",
      getSession: async () => null,
      putSession: async () => {},
      deleteSession: async () => {},
      listActive: async () => [],
      getRootContextId: async (id: string) => (id === "ctx-1" ? "root-1" : null),
      setRootContextId: async () => {},
    };

    const platformClient = {
      ...mockPlatformClient(),
      sendToAgent: async (_name: string, _message: string, opts?: any) => ({ response: opts?.rootContextId ?? "none", status: "completed" }),
    };

    const config = makeConfig();
    const p = new A2AProxyServer({ config, platformClient, sessionStore });
    p.start();
    await new Promise((r) => setTimeout(r, 100));
    const assignedPort = (p as any).server.address().port;

    const res = await httpRequest(assignedPort, "/a2a/send", {
      method: "POST",
      body: JSON.stringify({ agent: "agent-a", message: "hi", context_id: "ctx-1" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe("root-1");
    p.stop();
  });
});
