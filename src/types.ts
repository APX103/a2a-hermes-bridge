// === Configuration Types ===

export interface BridgeConfig {
  agent_name: string;
  agent_description: string;
  agent_version: string;
  platform_url: string;
  admin_token: string;
  hermes_url: string;
  hermes_api_key: string;
  hermes_model: string;
  hermes_timeout_ms: number;
  context_mode: "stateless" | "context";
  pull: {
    poll_interval_ms: number;
    poll_batch_size: number;
    heartbeat_interval_ms: number;
    max_workers: number;
  };
  session_store: { type: "sqlite" | "memory"; path: string };
  agent_card: {
    skills: Array<{ id: string; name: string; description: string }>;
    capabilities: { streaming: boolean };
  };
}

// === A2A JSON-RPC Protocol Types ===

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: {
    contextID?: string;
    message: {
      role: string;
      parts: Array<{ text?: string }>;
    };
  };
}

// === SSE Event Types (A2A Platform format) ===

export interface TaskStatusEvent {
  type: "task.status";
  taskId: string;
  contextId?: string;
  status: {
    state: "working" | "completed" | "failed";
    message?: { role: string; parts: Array<{ text: string }> };
  };
}

export interface TextDeltaEvent {
  type: "text.delta";
  taskId: string;
  contextId?: string;
  text: string;
}

// === Hermes Types ===

export interface HermesChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export type HermesStreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; toolName: string; arguments: string }
  | { type: "tool_end"; toolName: string }
  | { type: "done"; text: string };

// === Pull Mode Types ===

export interface PendingMessage {
  delivery_id: string;
  jsonrpc: JsonRpcRequest;
  created_at: string;
}

export interface TaskResult {
  state: "completed" | "failed";
  message?: { role: string; parts: Array<{ text: string }> };
  error?: string;
}

// === Event Output Interface ===

export interface EventOutput {
  emitWorking(taskId: string, contextId?: string): void;
  emitTextDelta(taskId: string, text: string, contextId?: string): void;
  emitThinking(taskId: string, text: string, contextId?: string): void;
  emitToolCallStart(taskId: string, name: string, args: string, contextId?: string): void;
  emitToolCallEnd(taskId: string, name: string, contextId?: string): void;
  emitCompleted(taskId: string, message: string, contextId?: string): void;
  emitFailed(taskId: string, error: string, contextId?: string): void;
}

// === Session Store Interface ===

export interface SessionRecord {
  contextId: string;
  hermesSessionId: string;
  createdAt: Date;
  lastUsed: Date;
}

export interface SessionStore {
  getOrCreateSession(contextId: string): Promise<string>;
  getSession(contextId: string): Promise<string | null>;
  putSession(contextId: string, hermesSessionId: string): Promise<void>;
  deleteSession(contextId: string): Promise<void>;
  listActive(): Promise<SessionRecord[]>;
}
