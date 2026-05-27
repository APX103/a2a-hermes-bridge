import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { InMemorySessionStore, SqliteSessionStore } from "../src/session-store";

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

describe("SqliteSessionStore", () => {
  let tmpDir: string;
  let store: SqliteSessionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bridge-test-"));
    store = new SqliteSessionStore(join(tmpDir, "sessions.db"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

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

  it("should persist across instances", async () => {
    const id = await store.getOrCreateSession("ctx-1");
    const path = join(tmpDir, "sessions.db");

    const store2 = new SqliteSessionStore(path);
    expect(await store2.getSession("ctx-1")).toBe(id);
  });
});
