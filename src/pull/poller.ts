import type { PlatformClient } from "../platform-client";
import type { MessageHandler } from "../message-handler";
import type { PendingMessage } from "../types";
import { ResultReporter } from "./result-reporter";

export interface PullPollerConfig {
  agentName: string;
  pollIntervalMs: number;
  pollBatchSize: number;
  heartbeatIntervalMs: number;
  maxWorkers: number;
}

export class PullPoller {
  private platformClient: PlatformClient;
  private handler: MessageHandler;
  private config: PullPollerConfig;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private processedIds = new Map<string, number>();
  private activeWorkers = 0;

  constructor(platformClient: PlatformClient, handler: MessageHandler, config: PullPollerConfig) {
    this.platformClient = platformClient;
    this.handler = handler;
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.doPoll();
    this.pollTimer = setInterval(() => this.doPoll(), this.config.pollIntervalMs);
    this.doHeartbeat();
    this.heartbeatTimer = setInterval(() => this.doHeartbeat(), this.config.heartbeatIntervalMs);
    console.log(`[PULL] started interval=${this.config.pollIntervalMs}ms agent=${this.config.agentName}`);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    console.log("[PULL] stopped");
  }

  private async doPoll(): Promise<void> {
    if (!this.running) return;
    try {
      const messages = await this.platformClient.pollPending(this.config.agentName, this.config.pollBatchSize);
      if (messages.length === 0) return;
      for (const msg of messages) {
        if (this.processedIds.has(msg.delivery_id)) continue;
        this.processedIds.set(msg.delivery_id, Date.now());
        if (this.activeWorkers >= this.config.maxWorkers) continue;
        this.activeWorkers++;
        this.processMessage(msg).finally(() => { this.activeWorkers--; });
      }
    } catch (err: any) {
      console.error(`[PULL] poll error: ${err.message}`);
    }
    // Purge old processed IDs (10 min TTL)
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, ts] of this.processedIds) { if (ts < cutoff) this.processedIds.delete(id); }
  }

  private async processMessage(msg: PendingMessage): Promise<void> {
    const startTime = Date.now();
    console.log(`[REQ] deliveryId=${msg.delivery_id} rpcId=${msg.jsonrpc?.id}`);
    try {
      const reporter = new ResultReporter(this.platformClient, this.config.agentName, msg.delivery_id);
      const result = await this.handler.handleMessage({
        rpcId: msg.jsonrpc.id,
        contextId: msg.jsonrpc.params?.contextID,
        rootContextId: msg.jsonrpc.params?.rootContextID ?? msg.jsonrpc.params?.contextID,
        messageParts: msg.jsonrpc.params?.message?.parts ?? [],
      }, reporter);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[RESP] deliveryId=${msg.delivery_id} status=${result.status} duration=${duration}s`);
    } catch (err: any) {
      console.error(`[ERR] deliveryId=${msg.delivery_id} error=${err.message}`);
    }
  }

  private async doHeartbeat(): Promise<void> {
    try { await this.platformClient.heartbeat(this.config.agentName); }
    catch (err: any) { console.warn(`[PULL] heartbeat failed: ${err.message}`); }
  }
}
