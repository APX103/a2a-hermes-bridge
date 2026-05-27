import type { BridgeConfig, PendingMessage, TaskResult } from "./types";

export class PlatformClient {
  private baseUrl: string;
  private adminToken: string;

  constructor(config: BridgeConfig) {
    this.baseUrl = config.platform_url.replace(/\/+$/, "");
    this.adminToken = config.admin_token;
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", "X-Admin-Token": this.adminToken };
  }

  async registerAsPull(config: {
    agentName: string; description: string; version: string; contextMode: string; agentCard: any;
  }): Promise<{ ok: boolean; name: string }> {
    const res = await fetch(`${this.baseUrl}/api/agents`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({
        name: config.agentName, type: "external", mode: "pull",
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
    await fetch(`${this.baseUrl}/api/agents/${agentName}/results/delta`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ delivery_id: deliveryId, task_id: taskId, type: type ?? "text.delta", text }),
    });
  }

  async submitFinal(agentName: string, deliveryId: string, taskId: string, state: string, message?: string): Promise<void> {
    const status: any = { state };
    if (message) status.message = { role: "agent", parts: [{ text: message }] };
    await fetch(`${this.baseUrl}/api/agents/${agentName}/results/final`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ delivery_id: deliveryId, task_id: taskId, type: "task.status", status }),
    });
  }

  async heartbeat(agentName: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/agents/${agentName}/heartbeat`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ status: "ready", timestamp: new Date().toISOString() }),
    });
  }

  async deregister(agentName: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/agents/${agentName}`, {
      method: "DELETE", headers: { "X-Admin-Token": this.adminToken },
    }).catch(() => {});
  }
}
