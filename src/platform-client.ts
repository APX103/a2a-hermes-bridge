import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import type { BridgeConfig, PendingMessage, TaskResult } from "./types";

export class PlatformClient {
  private baseUrl: string;
  private agentName: string;
  private secret: string;

  constructor(config: BridgeConfig) {
    this.baseUrl = config.platform_url.replace(/\/+$/, "");
    this.agentName = config.agent_name;
    this.secret = this.loadOrCreateSecret();
  }

  private tokenPath(): string {
    return `.a2a-agent-token-${this.agentName}`;
  }

  private loadOrCreateSecret(): string {
    const path = this.tokenPath();
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8").trim();
      } catch { /* fall through */ }
    }
    const secret = randomBytes(32).toString("hex");
    try {
      writeFileSync(path, secret, { mode: 0o600 });
    } catch { /* ignore write errors */ }
    return secret;
  }

  getSecret(): string {
    return this.secret;
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", "X-A2A-Agent-Secret": this.secret };
  }

  async registerAsPull(config: {
    agentName: string; description: string; version: string; contextMode: string; agentCard: any;
  }): Promise<{ ok: boolean; name: string }> {
    const url = `${this.baseUrl}/api/agents`;
    console.log(`[REGISTER] Connecting to platform at ${url}`);
    try {
      const res = await fetch(url, {
        method: "POST", headers: this.headers(),
        body: JSON.stringify({
          name: config.agentName, type: "external", mode: "pull",
          secret: this.secret,
          context_mode: config.contextMode,
          agent_card: { name: config.agentName, description: config.description, version: config.version, ...config.agentCard },
        }),
      });
      if (!res.ok) throw new Error(`Registration failed: ${res.status} ${await res.text()}`);
      const data: any = await res.json();
      return { ok: true, name: data.name ?? config.agentName };
    } catch (err: any) {
      throw new Error(`Registration failed for ${url}: ${err.message}`);
    }
  }

  async pollPending(agentName: string, limit: number): Promise<PendingMessage[]> {
    const res = await fetch(`${this.baseUrl}/api/agents/${agentName}/pending?limit=${limit}`, { headers: this.headers() });
    if (res.status === 404) throw new Error("Pull mode not supported by platform");
    if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
    const data: any = await res.json();
    return data.messages ?? [];
  }

  async submitDelta(agentName: string, deliveryId: string, taskId: string, text: string, type?: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/agents/${agentName}/results/delta`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ delivery_id: deliveryId, task_id: taskId, type: type ?? "text.delta", text }),
    });
    if (!res.ok) throw new Error(`Delta submission failed: ${res.status} ${await res.text()}`);
  }

  async submitFinal(agentName: string, deliveryId: string, taskId: string, state: string, message?: string): Promise<void> {
    const status: any = { state };
    if (message) status.message = message;
    const res = await fetch(`${this.baseUrl}/api/agents/${agentName}/results/final`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ delivery_id: deliveryId, task_id: taskId, type: "task.status", status }),
    });
    if (!res.ok) throw new Error(`Final submission failed: ${res.status} ${await res.text()}`);
  }

  async heartbeat(agentName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/agents/${agentName}/heartbeat`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ status: "ready", timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Heartbeat failed: ${res.status}`);
  }

  async deregister(agentName: string): Promise<void> {
    // Pull-mode agents should not be deregistered on shutdown;
    // they remain in the platform and reconnect with their secret.
    // This allows crash-recovery and intentional restarts without
    // losing the agent record.
  }

  async getAgentCard(name: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent-card/${name}`);
    if (!res.ok) throw new Error(`Agent card fetch failed: ${res.status}`);
    return res.json();
  }

  async listGroups(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/groups`);
    if (!res.ok) throw new Error(`List groups failed: ${res.status}`);
    const data: any = await res.json();
    return Array.isArray(data) ? data : data.groups ?? [];
  }

  async listGroupAgents(groupID: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/groups/${encodeURIComponent(groupID)}/members`);
    if (!res.ok) throw new Error(`List group members failed: ${res.status}`);
    const members: any[] = (await res.json()) as any[];
    // Filter to agents only and enrich with agent cards
    const agents: any[] = [];
    for (const m of members) {
      const actorType = m.actor_type ?? m.actorType ?? "";
      const actorID = m.actor_id ?? m.actorID ?? "";
      if (actorType !== "agent" || !actorID || actorID === this.agentName) continue;
      try {
        const card = await this.getAgentCard(actorID);
        agents.push({ name: actorID, role: m.role ?? "", card });
      } catch {
        agents.push({ name: actorID, role: m.role ?? "" });
      }
    }
    return agents;
  }

  async sendToAgent(
    targetAgent: string,
    message: string,
    options?: { contextId?: string; groupId?: string; rootContextId?: string },
  ): Promise<{ response: string; status: string; error?: string }> {
    const rpcReq = {
      jsonrpc: "2.0" as const,
      id: `hermes-out-${Date.now()}`,
      method: "agent",
      params: {
        ...(options?.contextId ? { contextID: options.contextId } : {}),
        ...(options?.rootContextId ? { rootContextID: options.rootContextId } : {}),
        message: { role: "user", parts: [{ text: message }] },
      },
    };

    const res = await fetch(`${this.baseUrl}/agent/${targetAgent}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-A2A-Source-Agent": this.agentName,
        ...(options?.groupId ? { "X-A2A-Group-ID": options.groupId } : {}),
        ...(options?.rootContextId ? { "X-A2A-Root-Context-ID": options.rootContextId } : {}),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(rpcReq),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { response: "", status: "failed", error: `HTTP ${res.status}: ${text}` };
    }

    if (!res.body) {
      return { response: "", status: "failed", error: "empty response body" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let finalMessage = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data) continue;
            try {
              const event = JSON.parse(data);
              if (event.type === "text.delta" && event.text) {
                fullText += event.text;
              } else if (event.type === "task.status" && event.status) {
                if (event.status.state === "completed" && event.status.message?.parts?.[0]?.text) {
                  finalMessage = event.status.message.parts[0].text;
                }
              }
            } catch { /* ignore malformed JSON */ }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const responseText = finalMessage || fullText;
    return { response: responseText, status: "completed" };
  }
}
