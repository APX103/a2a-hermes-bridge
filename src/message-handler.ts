import { v4 as uuid } from "uuid";
import type { HermesClient } from "./hermes-client";
import type { SessionStore, EventOutput } from "./types";

export interface HandleResult {
  taskId: string;
  status: "completed" | "failed";
  message: string;
}

export class MessageHandler {
  constructor(
    private hermesClient: HermesClient,
    private sessionStore: SessionStore,
    private contextMode: "stateless" | "context",
  ) {}

  async handleMessage(
    params: { rpcId: string; contextId?: string; rootContextId?: string; messageParts: Array<{ text?: string }> },
    output: EventOutput,
  ): Promise<HandleResult> {
    const taskId = `hermes-${uuid().slice(0, 8)}`;
    const contextId = params.contextId;

    const inputText = params.messageParts.map((p) => p.text ?? "").filter(Boolean).join("\n");
    if (!inputText.trim()) {
      output.emitFailed(taskId, "Empty message", contextId);
      return { taskId, status: "failed", message: "Empty message" };
    }

    if (contextId && params.rootContextId) {
      try { await this.sessionStore.setRootContextId(contextId, params.rootContextId); }
      catch { /* ignore */ }
    }

    let sessionId: string | undefined;
    if (this.contextMode === "context" && contextId) {
      try { sessionId = await this.sessionStore.getOrCreateSession(contextId); }
      catch { sessionId = undefined; }
    }

    output.emitWorking(taskId, contextId);

    try {
      let fullText = "";
      for await (const chunk of this.hermesClient.chatStreaming({
        messages: [{ role: "user", content: inputText }],
        sessionId,
      })) {
        if (chunk.type === "text") { fullText += chunk.text; output.emitTextDelta(taskId, chunk.text, contextId); }
        else if (chunk.type === "thinking") { output.emitThinking(taskId, chunk.text, contextId); }
        else if (chunk.type === "tool_start") { output.emitToolCallStart(taskId, chunk.toolName, chunk.arguments, contextId); }
        else if (chunk.type === "tool_end") { output.emitToolCallEnd(taskId, chunk.toolName, contextId); }
      }
      output.emitCompleted(taskId, fullText, contextId);
      return { taskId, status: "completed", message: fullText };
    } catch (err: any) {
      const msg = err?.message ?? "Unknown error";
      output.emitFailed(taskId, msg, contextId);
      return { taskId, status: "failed", message: msg };
    }
  }
}
