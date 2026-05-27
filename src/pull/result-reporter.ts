import type { PlatformClient } from "../platform-client";
import type { EventOutput } from "../types";

export class ResultReporter implements EventOutput {
  constructor(
    private platformClient: PlatformClient,
    private agentName: string,
    private deliveryId: string,
  ) {}

  emitWorking(taskId: string, contextId?: string): void {
    this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "working").catch(() => {});
  }

  emitTextDelta(taskId: string, text: string, contextId?: string): void {
    this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, text).catch(() => {});
  }

  emitThinking(taskId: string, text: string, contextId?: string): void {
    this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, text).catch(() => {});
  }

  emitToolCallStart(): void { /* not supported in chunked reporting yet */ }
  emitToolCallEnd(): void { /* not supported in chunked reporting yet */ }

  emitCompleted(taskId: string, message: string, contextId?: string): void {
    this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "completed", message).catch(() => {});
  }

  emitFailed(taskId: string, error: string, contextId?: string): void {
    this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "failed", error).catch(() => {});
  }
}
