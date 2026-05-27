import type { PlatformClient } from "../platform-client";
import type { EventOutput } from "../types";

export class ResultReporter implements EventOutput {
  private pending = Promise.resolve();

  constructor(
    private platformClient: PlatformClient,
    private agentName: string,
    private deliveryId: string,
  ) {}

  private enqueue(task: () => Promise<void>): void {
    this.pending = this.pending.then(task).catch((e) => {
      console.error(`[REPORT] queued task failed: ${e?.message ?? e}`);
    });
  }

  emitWorking(taskId: string, contextId?: string): void {
    this.enqueue(() =>
      this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, "", "task.status")
    );
  }

  emitTextDelta(taskId: string, text: string, contextId?: string): void {
    this.enqueue(() =>
      this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, text)
        .then(() => process.stdout.write("."))
        .catch((e) => {
          process.stdout.write(`X(${e?.message ?? e})`);
          throw e;
        })
    );
  }

  emitThinking(taskId: string, text: string, contextId?: string): void {
    this.enqueue(() =>
      this.platformClient.submitDelta(this.agentName, this.deliveryId, taskId, text)
    );
  }

  emitToolCallStart(): void { /* not supported in chunked reporting yet */ }
  emitToolCallEnd(): void { /* not supported in chunked reporting yet */ }

  emitCompleted(taskId: string, message: string, contextId?: string): void {
    this.enqueue(() =>
      this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "completed", message)
        .then(() => console.log(`[REPORT] completed sent OK deliveryId=${this.deliveryId}`))
    );
  }

  emitFailed(taskId: string, error: string, contextId?: string): void {
    this.enqueue(() =>
      this.platformClient.submitFinal(this.agentName, this.deliveryId, taskId, "failed", error)
    );
  }
}
