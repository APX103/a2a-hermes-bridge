import { describe, it, expect, beforeEach } from "vitest";
import { InMemorySessionStore } from "../src/session-store";

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;
  beforeEach(() => { store = new InMemorySessionStore(); });

  it("should create and retrieve session", async () => {
    const id = await store.getOrCreateSession("ctx-1");
    expect(id).toBeTruthy();
    expect(await store.getSession("ctx-1")).toBe(id);
  });

  it("should return same session for same contextId", async () => {
    const id1 = await store.getOrCreateSession("ctx-1");
    const id2 = await store.getOrCreateSession("ctx-1");
    expect(id1).toBe(id2);
  });

  it("should return null for unknown contextId", async () => {
    expect(await store.getSession("unknown")).toBeNull();
  });

  it("should delete session", async () => {
    await store.getOrCreateSession("ctx-1");
    await store.deleteSession("ctx-1");
    expect(await store.getSession("ctx-1")).toBeNull();
  });

  it("should list active sessions", async () => {
    await store.getOrCreateSession("ctx-1");
    await store.getOrCreateSession("ctx-2");
    expect((await store.listActive()).length).toBe(2);
  });
});
