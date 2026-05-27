import type { PlatformClient } from "../platform-client";
import type { EventOutput } from "../types";

export class ResultReporter implements EventOutput {
  constructor(
    private platformClient: PlatformClient,
    private agentName: string,
    private deliveryId: string,
  ) {}

  emitWorking(taskId: string, contextId?: string): void {
    this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, "", "task.status")
      .catch(e => console.error(`[REPORT] emitWorking failed: ${e?.message ?? e}`));
  }

  emitTextDelta(taskId: string, text: string, contextId?: string): void {
    this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, text)
      .then(() => process.stdout.write("."))
      .catch(e => process.stdout.write(`X(${e?.message ?? e})`));
  }

  emitThinking(taskId: string, text: string, contextId?: string): void {
    this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, text)
      .catch(e => console.error(`[REPORT] emitThinking failed: ${e?.message ?? e}`));
  }

  emitToolCallStart(): void { /* not supported in chunked reporting yet */ }
  emitToolCallEnd(): void { /* not supported in chunked reporting yet */ }

  emitCompleted(taskId: string, message: string, contextId?: string): void {
    this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "completed", message)
      .then(() => console.log(`[REPORT] completed sent OK deliveryId=${this.deliveryId}`))
      .catch(e => console.error(`[REPORT] emitCompleted failed: ${e?.message ?? e}`));
  }

  emitFailed(taskId: string, error: string, contextId?: string): void {
    this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "failed", error)
      .catch(e => console.error(`[REPORT] emitFailed failed: ${e?.message ?? e}`));
  }
}
