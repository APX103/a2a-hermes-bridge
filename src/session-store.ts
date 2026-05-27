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
