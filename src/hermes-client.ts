import type { HermesChatMessage, HermesStreamChunk } from "./types";

export interface HermesClientOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

export class HermesClient {
  private baseUrl: string;
  private apiKey?: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: HermesClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs;
  }

  async *chatStreaming(params: {
    messages: HermesChatMessage[];
    sessionId?: string;
    sessionKey?: string;
  }): AsyncGenerator<HermesStreamChunk> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (params.sessionId) headers["X-Hermes-Session-Id"] = params.sessionId;
    if (params.sessionKey) headers["X-Hermes-Session-Key"] = params.sessionKey;

    const body = JSON.stringify({ model: this.model, messages: params.messages, stream: true });

    // Retry once on 5xx
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST", headers, body, signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (response.status < 500) break;
      if (attempt === 0) {
        const errText = await response.text().catch(() => "");
        console.warn(`[WARN] Hermes ${response.status}, retrying...`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    }

    if (!response!.ok) {
      const errText = await response!.text().catch(() => "");
      throw new Error(`Hermes HTTP ${response!.status}: ${errText.slice(0, 200)}`);
    }

    const reader = response!.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) yield { type: "thinking", text: delta.reasoning_content };
          if (delta?.content) yield { type: "text", text: delta.content };
        } catch { /* skip malformed */ }
      }
    }

    // Process any remaining line in buffer after stream ends
    if (buffer) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data !== "[DONE]") {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.reasoning_content) yield { type: "thinking", text: delta.reasoning_content };
            if (delta?.content) yield { type: "text", text: delta.content };
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; status?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { ok: false };
      const data = (await response.json()) as Record<string, unknown>;
      return { ok: true, status: data.status as string | undefined };
    } catch {
      return { ok: false };
    }
  }
}
