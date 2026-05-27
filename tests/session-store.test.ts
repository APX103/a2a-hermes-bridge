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

  it("should set and get rootContextId", async () => {
    await store.getOrCreateSession("ctx-1");
    expect(await store.getRootContextId("ctx-1")).toBeNull();
    await store.setRootContextId("ctx-1", "root-1");
    expect(await store.getRootContextId("ctx-1")).toBe("root-1");
  });

  it("should set rootContextId before session exists", async () => {
    await store.setRootContextId("ctx-new", "root-new");
    expect(await store.getRootContextId("ctx-new")).toBe("root-new");
    expect(await store.getSession("ctx-new")).toBeTruthy();
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

  it("should set and get rootContextId", async () => {
    await store.getOrCreateSession("ctx-1");
    expect(await store.getRootContextId("ctx-1")).toBeNull();
    await store.setRootContextId("ctx-1", "root-1");
    expect(await store.getRootContextId("ctx-1")).toBe("root-1");
  });

  it("should persist rootContextId across instances", async () => {
    await store.getOrCreateSession("ctx-1");
    await store.setRootContextId("ctx-1", "root-1");
    const path = join(tmpDir, "sessions.db");

    const store2 = new SqliteSessionStore(path);
    expect(await store2.getRootContextId("ctx-1")).toBe("root-1");
  });
});
