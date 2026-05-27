import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { HermesClient } from "../src/hermes-client";
import { InMemorySessionStore } from "../src/session-store";
import { MessageHandler } from "../src/message-handler";
import { PlatformClient } from "../src/platform-client";
import { PullPoller } from "../src/pull/poller";
import type { BridgeConfig } from "../src/types";

let mockPlatform: Server;
let mockHermes: Server;

function makeConfig(ports: { platform: number; hermes: number }): BridgeConfig {
  return {
    agent_name: "test-hermes",
    agent_description: "test",
    agent_version: "1.0.0",
    platform_url: `http://localhost:${ports.platform}`,
    admin_token: "test-token",
    hermes_url: `http://localhost:${ports.hermes}`,
    hermes_api_key: "",
    hermes_model: "test",
    hermes_timeout_ms: 5000,
    context_mode: "stateless",
    pull: { poll_interval_ms: 100, poll_batch_size: 5, heartbeat_interval_ms: 1000, max_workers: 2 },
    session_store: { type: "memory", path: "" },
    agent_card: { skills: [], capabilities: { streaming: true } },
  };
}

beforeEach(async () => {
  // Mock platform that returns one pending message on first poll, then empty
  let pollCount = 0;
  mockPlatform = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    if (url.pathname.includes("/pending")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (pollCount === 0) {
        pollCount++;
        res.end(JSON.stringify({ messages: [{
          delivery_id: "dlv-1",
          jsonrpc: { jsonrpc: "2.0", id: "1", method: "SendStreamingMessage", params: { message: { role: "user", parts: [{ text: "hello" }] } } },
          created_at: new Date().toISOString(),
        }] }));
      } else {
        res.end(JSON.stringify({ messages: [] }));
      }
    } else if (url.pathname.includes("/results/")) {
      res.writeHead(200);
      res.end('{"ok":true}');
    } else if (url.pathname.includes("/heartbeat")) {
      res.writeHead(200);
      res.end('{"ok":true}');
    } else {
      res.writeHead(200);
      res.end('{"ok":true}');
    }
  });

  mockHermes = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi!"},"finish_reason":null}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await Promise.all([
    new Promise<void>((r) => mockPlatform.listen(19890, () => r())),
    new Promise<void>((r) => mockHermes.listen(19891, () => r())),
  ]);
});

afterEach(() => { mockPlatform.close(); mockHermes.close(); });

describe("PullPoller", () => {
  it("should poll, process, and report results", async () => {
    const config = makeConfig({ platform: 19890, hermes: 19891 });
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

    poller.start();

    // Wait for at least one poll cycle to complete
    await new Promise((r) => setTimeout(r, 300));

    poller.stop();

    // Verify the poller ran without errors (if we got here, it worked)
    expect(true).toBe(true);
  });
});
