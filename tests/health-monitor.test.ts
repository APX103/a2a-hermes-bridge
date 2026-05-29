import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { HermesClient } from "../src/hermes-client";
import { InMemorySessionStore } from "../src/session-store";
import { MessageHandler } from "../src/message-handler";
import { PlatformClient } from "../src/platform-client";
import { PullPoller } from "../src/pull/poller";
import type { BridgeConfig } from "../src/types";

function makeConfig(ports: { platform: number; hermes: number }): BridgeConfig {
  return {
    agent_name: "test-hermes",
    agent_description: "test",
    agent_version: "1.0.0",
    platform_url: `http://localhost:${ports.platform}`,
    hermes_url: `http://localhost:${ports.hermes}`,
    hermes_api_key: "",
    hermes_model: "test",
    hermes_timeout_ms: 5000,
    context_mode: "stateless",
    pull: { poll_interval_ms: 100, poll_batch_size: 5, heartbeat_interval_ms: 1000, max_workers: 2 },
    session_store: { type: "memory", path: "" },
    a2a_proxy_port: 28091,
    known_agents: [],
    agent_card: { skills: [], capabilities: { streaming: true } },
  };
}

let mockPlatform: Server;
let mockHermes: Server;
let hermesPort: number;

beforeEach(async () => {
  mockPlatform = createServer((_req, res) => {
    res.writeHead(200);
    res.end('{"ok":true}');
  });

  mockHermes = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });

  await new Promise<void>((r) => mockPlatform.listen(0, () => r()));
  await new Promise<void>((r) => mockHermes.listen(0, () => r()));
  hermesPort = (mockHermes.address() as any).port;
});

afterEach(() => {
  mockPlatform.close();
  mockHermes.close();
});

describe("HermesClient healthCheck", () => {
  it("should return ok when server returns 200", async () => {
    const client = new HermesClient({ baseUrl: `http://localhost:${hermesPort}`, model: "test", timeoutMs: 5000 });
    const result = await client.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.error).toBeUndefined();
  });

  it("should return error with HTTP status on non-200", async () => {
    mockHermes.close();
    mockHermes = createServer((_req, res) => {
      res.writeHead(503);
      res.end("Service Unavailable");
    });
    await new Promise<void>((r) => mockHermes.listen(hermesPort, () => r()));

    const client = new HermesClient({ baseUrl: `http://localhost:${hermesPort}`, model: "test", timeoutMs: 5000 });
    const result = await client.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("503");
  });

  it("should return error message on connection refused", async () => {
    const client = new HermesClient({ baseUrl: "http://localhost:59999", model: "test", timeoutMs: 3000 });
    const result = await client.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("PullPoller pause/resume", () => {
  it("should report running state correctly", async () => {
    const platformPort = (mockPlatform.address() as any).port;
    const config = makeConfig({ platform: platformPort, hermes: hermesPort });
    const hermes = new HermesClient({ baseUrl: config.hermes_url, model: "test", timeoutMs: 5000 });
    const handler = new MessageHandler(hermes, new InMemorySessionStore(), "stateless");
    const platformClient = new PlatformClient(config);
    const poller = new PullPoller(platformClient, handler, {
      agentName: config.agent_name,
      pollIntervalMs: 50,
      pollBatchSize: 5,
      heartbeatIntervalMs: 5000,
      maxWorkers: 2,
    });

    expect(poller.isRunning()).toBe(false);
    poller.start();
    expect(poller.isRunning()).toBe(true);
    poller.stop();
    expect(poller.isRunning()).toBe(false);
  });
});
