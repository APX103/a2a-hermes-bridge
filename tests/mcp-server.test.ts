import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleToolCall } from "../src/mcp-server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function mockFetch(responses: Array<{ match: (url: string, init?: any) => boolean; response: Response }>): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const r of responses) {
      if (r.match(url, init)) return r.response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("handleToolCall", () => {
  describe("a2a_list_groups", () => {
    it("should list groups successfully", async () => {
      const fetchImpl = mockFetch([
        {
          match: (url) => url.includes("/a2a/groups"),
          response: jsonResponse({ groups: [{ id: "g1", name: "Group1", mode: "p2p", status: "active" }] }),
        },
      ]);
      const result = await handleToolCall("a2a_list_groups", {}, { fetchImpl });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Group1");
    });

    it("should handle empty groups", async () => {
      const fetchImpl = mockFetch([{ match: (url) => url.includes("/a2a/groups"), response: jsonResponse({ groups: [] }) }]);
      const result = await handleToolCall("a2a_list_groups", {}, { fetchImpl });
      expect(result.content[0].text).toBe("No groups found.");
    });

    it("should return error on fetch failure", async () => {
      const fetchImpl = mockFetch([{ match: (url) => url.includes("/a2a/groups"), response: jsonResponse({}, 503) }]);
      const result = await handleToolCall("a2a_list_groups", {}, { fetchImpl });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("503");
    });
  });

  describe("a2a_list_group_agents", () => {
    it("should require group_id", async () => {
      const result = await handleToolCall("a2a_list_group_agents", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("group_id is required");
    });

    it("should list agents", async () => {
      const fetchImpl = mockFetch([
        {
          match: (url) => url.includes("/a2a/groups/g1/agents"),
          response: jsonResponse({ agents: [{ name: "agent-a", role: "worker", card: { skills: [{ name: "Skill1" }] } }] }),
        },
      ]);
      const result = await handleToolCall("a2a_list_group_agents", { group_id: "g1" }, { fetchImpl });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("agent-a");
    });
  });

  describe("a2a_get_agent_card", () => {
    it("should require agent", async () => {
      const result = await handleToolCall("a2a_get_agent_card", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("agent is required");
    });

    it("should return agent card", async () => {
      const fetchImpl = mockFetch([
        {
          match: (url) => url.includes("/a2a/agent-card/agent-a"),
          response: jsonResponse({ name: "agent-a", description: "desc", skills: [{ name: "Skill1" }], capabilities: { streaming: true } }),
        },
      ]);
      const result = await handleToolCall("a2a_get_agent_card", { agent: "agent-a" }, { fetchImpl });
      expect(result.content[0].text).toContain("agent-a");
      expect(result.content[0].text).toContain("desc");
    });
  });

  describe("a2a_send_to_agent", () => {
    it("should require all mandatory fields", async () => {
      const result = await handleToolCall("a2a_send_to_agent", { agent: "a" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("required");
    });

    it("should send and return response", async () => {
      const fetchImpl = mockFetch([
        {
          match: (url, init) => url.includes("/a2a/send") && init?.method === "POST",
          response: jsonResponse({ status: "completed", response: "Done!" }),
        },
      ]);
      const result = await handleToolCall("a2a_send_to_agent", { agent: "agent-a", message: "hello", group_id: "g1" }, { fetchImpl });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("Done!");
    });

    it("should handle failed task", async () => {
      const fetchImpl = mockFetch([
        {
          match: (url, init) => url.includes("/a2a/send") && init?.method === "POST",
          response: jsonResponse({ status: "failed", error: "Agent busy" }),
        },
      ]);
      const result = await handleToolCall("a2a_send_to_agent", { agent: "agent-a", message: "hello", group_id: "g1" }, { fetchImpl });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Agent busy");
    });
  });

  describe("a2a_bridge_status", () => {
    it("should report online", async () => {
      const fetchImpl = mockFetch([{ match: (url) => url.includes("/a2a/groups"), response: jsonResponse({ groups: [] }) }]);
      const result = await handleToolCall("a2a_bridge_status", {}, { fetchImpl });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Bridge is online.");
    });

    it("should report offline with isError", async () => {
      const fetchImpl = mockFetch([{ match: (url) => url.includes("/a2a/groups"), response: jsonResponse({}, 503) }]);
      const result = await handleToolCall("a2a_bridge_status", {}, { fetchImpl });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("503");
    });

    it("should report unreachable with isError", async () => {
      const fetchImpl = async () => { throw new Error("Connection refused"); };
      const result = await handleToolCall("a2a_bridge_status", {}, { fetchImpl });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Connection refused");
    });
  });

  describe("a2a_update_known_agents", () => {
    let tmpDir: string;
    let configPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
      configPath = join(tmpDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ known_agents: ["old"], platform_url: "http://localhost" }) + "\n");
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should validate agents is string array", async () => {
      const result = await handleToolCall("a2a_update_known_agents", { agents: [1, 2, 3] }, { configPath });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("array of strings");
    });

    it("should atomically update known_agents", async () => {
      const result = await handleToolCall("a2a_update_known_agents", { agents: ["a", "b"] }, { configPath });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("a, b");
      // Verify file was updated
      const updated = JSON.parse(require("fs").readFileSync(configPath, "utf-8"));
      expect(updated.known_agents).toEqual(["a", "b"]);
    });
  });

  describe("unknown tool", () => {
    it("should throw on unknown tool", async () => {
      await expect(handleToolCall("a2a_unknown_tool", {})).rejects.toThrow("Unknown tool");
    });
  });
});
