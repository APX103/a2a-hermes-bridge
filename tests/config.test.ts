import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("should parse valid config with defaults", () => {
    const raw = {
      agent_name: "hermes",
      platform_url: "http://localhost:18090",
      admin_token: "test-token",
      hermes_url: "http://localhost:8642",
    };
    const config = loadConfig(raw);
    expect(config.agent_name).toBe("hermes");
    expect(config.context_mode).toBe("stateless");
    expect(config.hermes_timeout_ms).toBe(120000);
    expect(config.pull.poll_interval_ms).toBe(2000);
    expect(config.pull.max_workers).toBe(4);
  });

  it("should reject config missing required fields", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("should override with env vars", () => {
    process.env.HERMES_BRIDGE_HERMES_URL = "http://custom:9999";
    const raw = {
      agent_name: "hermes",
      platform_url: "http://localhost:18090",
      admin_token: "test-token",
      hermes_url: "http://localhost:8642",
    };
    const config = loadConfig(raw);
    expect(config.hermes_url).toBe("http://custom:9999");
    delete process.env.HERMES_BRIDGE_HERMES_URL;
  });
});
