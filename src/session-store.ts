import { v4 as uuid } from "uuid";
import type { SessionStore, SessionRecord } from "./types";

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async getOrCreateSession(contextId: string): Promise<string> {
    const existing = this.sessions.get(contextId);
    if (existing) { existing.lastUsed = new Date(); return existing.hermesSessionId; }
    const id = `hermes-${uuid().slice(0, 8)}`;
    const now = new Date();
    this.sessions.set(contextId, { contextId, hermesSessionId: id, createdAt: now, lastUsed: now });
    return id;
  }

  async getSession(contextId: string): Promise<string | null> {
    return this.sessions.get(contextId)?.hermesSessionId ?? null;
  }

  async putSession(contextId: string, hermesSessionId: string): Promise<void> {
    const now = new Date();
    this.sessions.set(contextId, { contextId, hermesSessionId, createdAt: now, lastUsed: now });
  }

  async deleteSession(contextId: string): Promise<void> { this.sessions.delete(contextId); }
  async listActive(): Promise<SessionRecord[]> { return Array.from(this.sessions.values()); }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export class SqliteSessionStore implements SessionStore {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        context_id TEXT PRIMARY KEY,
        hermes_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used TEXT NOT NULL
      )
    `);
  }

  async getOrCreateSession(contextId: string): Promise<string> {
    const row = this.db.prepare("SELECT hermes_session_id FROM sessions WHERE context_id = ?").get(contextId) as
      | { hermes_session_id: string }
      | undefined;
    if (row) {
      this.db.prepare("UPDATE sessions SET last_used = ? WHERE context_id = ?").run(
        new Date().toISOString(),
        contextId,
      );
      return row.hermes_session_id;
    }
    const id = `hermes-${uuid().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO sessions (context_id, hermes_session_id, created_at, last_used) VALUES (?, ?, ?, ?)",
    ).run(contextId, id, now, now);
    return id;
  }

  async getSession(contextId: string): Promise<string | null> {
    const row = this.db.prepare("SELECT hermes_session_id FROM sessions WHERE context_id = ?").get(contextId) as
      | { hermes_session_id: string }
      | undefined;
    return row?.hermes_session_id ?? null;
  }

  async putSession(contextId: string, hermesSessionId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      "INSERT OR REPLACE INTO sessions (context_id, hermes_session_id, created_at, last_used) VALUES (?, ?, ?, ?)",
    ).run(contextId, hermesSessionId, now, now);
  }

  async deleteSession(contextId: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE context_id = ?").run(contextId);
  }

  async listActive(): Promise<SessionRecord[]> {
    const rows = this.db.prepare("SELECT context_id, hermes_session_id, created_at, last_used FROM sessions").all() as Array<{
      context_id: string;
      hermes_session_id: string;
      created_at: string;
      last_used: string;
    }>;
    return rows.map((r) => ({
      contextId: r.context_id,
      hermesSessionId: r.hermes_session_id,
      createdAt: new Date(r.created_at),
      lastUsed: new Date(r.last_used),
    }));
  }
}

export function createSessionStore(config: { type: string; path: string }): SessionStore {
  if (config.type === "sqlite") {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 5)) {
      throw new Error(
        `SQLite session store requires Node.js >= 22.5.0 (current: ${process.versions.node}). ` +
          `Please upgrade Node.js or use "memory" session store.`,
      );
    }
    return new SqliteSessionStore(config.path);
  }
  return new InMemorySessionStore();
}
