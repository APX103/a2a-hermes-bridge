import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { HermesClient } from "../src/hermes-client";
import { InMemorySessionStore } from "../src/session-store";
import { MessageHandler } from "../src/message-handler";
import type { EventOutput } from "../src/types";

function mockHermes(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello!"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    s.listen(port, () => resolve(s));
  });
}

describe("MessageHandler", () => {
  let server: Server;

  afterEach(() => { server?.close(); });

  it("should process stateless message and emit events", async () => {
    server = await mockHermes(19876);
    const hermes = new HermesClient({ baseUrl: "http://localhost:19876", model: "test", timeoutMs: 5000 });
    const handler = new MessageHandler(hermes, new InMemorySessionStore(), "stateless");

    const events: Array<{ type: string; [k: string]: any }> = [];
    const output: EventOutput = {
      emitWorking(t) { events.push({ type: "working", taskId: t }); },
      emitTextDelta(t, text) { events.push({ type: "text.delta", taskId: t, text }); },
      emitThinking() {},
      emitToolCallStart() {},
      emitToolCallEnd() {},
      emitCompleted(t, msg) { events.push({ type: "completed", taskId: t, message: msg }); },
      emitFailed(t, err) { events.push({ type: "failed", taskId: t, error: err }); },
    };

    const result = await handler.handleMessage({ rpcId: "1", messageParts: [{ text: "hi" }] }, output);
    expect(result.status).toBe("completed");
    expect(result.message).toBe("Hello!");
    expect(events[0].type).toBe("working");
    expect(events.some((e) => e.type === "text.delta" && e.text === "Hello!")).toBe(true);
    expect(events[events.length - 1].type).toBe("completed");
  });

  it("should save rootContextId to session store", async () => {
    server = await mockHermes(19878);
    const hermes = new HermesClient({ baseUrl: "http://localhost:19878", model: "test", timeoutMs: 5000 });
    const store = new InMemorySessionStore();
    const handler = new MessageHandler(hermes, store, "context");

    const output: EventOutput = {
      emitWorking() {}, emitTextDelta() {}, emitThinking() {}, emitToolCallStart() {}, emitToolCallEnd() {},
      emitCompleted() {},
      emitFailed() {},
    };

    await handler.handleMessage({ rpcId: "1", contextId: "ctx-abc", rootContextId: "root-xyz", messageParts: [{ text: "hi" }] }, output);
    expect(await store.getRootContextId("ctx-abc")).toBe("root-xyz");
  });

  it("should handle Hermes errors gracefully", async () => {
    const s = createServer((_req, res) => { res.writeHead(503); res.end("unavailable"); });
    await new Promise<void>((r) => s.listen(19877, () => r()));
    server = s;

    const hermes = new HermesClient({ baseUrl: "http://localhost:19877", model: "test", timeoutMs: 3000 });
    const handler = new MessageHandler(hermes, new InMemorySessionStore(), "stateless");

    const events: Array<{ type: string }> = [];
    const output: EventOutput = {
      emitWorking() {}, emitTextDelta() {}, emitThinking() {}, emitToolCallStart() {}, emitToolCallEnd() {},
      emitCompleted() {},
      emitFailed(t, err) { events.push({ type: "failed" }); },
    };

    const result = await handler.handleMessage({ rpcId: "1", messageParts: [{ text: "hi" }] }, output);
    expect(result.status).toBe("failed");
    expect(events.some((e) => e.type === "failed")).toBe(true);
  });
});
