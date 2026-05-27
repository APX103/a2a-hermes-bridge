import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import { HermesClient } from "../src/hermes-client";

let server: Server;
let client: HermesClient;
let receivedBody: any;

beforeEach(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;
  client = new HermesClient({ baseUrl: `http://localhost:${port}`, model: "hermes-agent", timeoutMs: 5000 });
});

afterEach(() => { server.close(); });

describe("HermesClient", () => {
  it("should stream chat completions", async () => {
    const chunks: string[] = [];
    for await (const chunk of client.chatStreaming({
      messages: [{ role: "user", content: "hello" }],
    })) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }
    expect(chunks).toEqual(["Hello", " world"]);
  });

  it("should send correct request body", async () => {
    for await (const _ of client.chatStreaming({ messages: [{ role: "user", content: "test" }] })) {}
    expect(receivedBody.model).toBe("hermes-agent");
    expect(receivedBody.stream).toBe(true);
    expect(receivedBody.messages[0].content).toBe("test");
  });

  it("should include session header when provided", async () => {
    let receivedHeaders: any = {};
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });

    for await (const _ of client.chatStreaming({
      messages: [{ role: "user", content: "hi" }],
      sessionId: "sess-123",
    })) {}
    expect(receivedHeaders["x-hermes-session-id"]).toBe("sess-123");
  });

  it("should perform health check", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    const result = await client.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("should throw on HTTP error with retry exhaustion", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Service Unavailable");
    });
    await expect(async () => {
      for await (const _ of client.chatStreaming({ messages: [{ role: "user", content: "hi" }] })) {}
    }).rejects.toThrow("503");
  });
});
