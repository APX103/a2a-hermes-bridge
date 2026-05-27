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
    return { "Content-Type": "application/json" };
  }

  async registerAsPull(config: {
    agentName: string; description: string; version: string; contextMode: string; agentCard: any;
  }): Promise<{ ok: boolean; name: string }> {
    const res = await fetch(`${this.baseUrl}/api/agents`, {
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
    await fetch(`${this.baseUrl}/api/agents/${agentName}/heartbeat`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ status: "ready", timestamp: new Date().toISOString() }),
    });
  }

  async deregister(agentName: string): Promise<void> {
    // Pull-mode agents should not be deregistered on shutdown;
    // they remain in the platform and reconnect with their secret.
    // This allows crash-recovery and intentional restarts without
    // losing the agent record.
  }
}
