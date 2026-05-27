import { z } from "zod";
import type { BridgeConfig } from "./types";

const configSchema = z.object({
  agent_name: z.string().min(1),
  agent_description: z.string().default("Hermes AI Agent"),
  agent_version: z.string().default("1.0.0"),
  platform_url: z.string().url(),

  hermes_url: z.string().url(),
  hermes_api_key: z.string().default(""),
  hermes_model: z.string().default("hermes-agent"),
  hermes_timeout_ms: z.number().positive().default(120000),
  context_mode: z.enum(["stateless", "context"]).default("stateless"),
  pull: z.object({
    poll_interval_ms: z.number().positive().default(2000),
    poll_batch_size: z.number().positive().default(10),
    heartbeat_interval_ms: z.number().positive().default(15000),
    max_workers: z.number().positive().default(4),
  }).default({}),
  session_store: z.object({
    type: z.enum(["sqlite", "memory"]).default("memory"),
    path: z.string().default("./sessions.db"),
  }).default({}),
  agent_card: z.object({
    skills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })).default([{ id: "chat", name: "Chat", description: "General conversation" }]),
    capabilities: z.object({ streaming: z.boolean().default(true) }).default({}),
  }).default({}),
});

export function loadConfig(raw: Record<string, unknown>): BridgeConfig {
  const envOverrides: Record<string, unknown> = {};
  if (process.env.HERMES_BRIDGE_PLATFORM_URL) envOverrides.platform_url = process.env.HERMES_BRIDGE_PLATFORM_URL;

  if (process.env.HERMES_BRIDGE_HERMES_URL) envOverrides.hermes_url = process.env.HERMES_BRIDGE_HERMES_URL;
  if (process.env.HERMES_BRIDGE_HERMES_API_KEY) envOverrides.hermes_api_key = process.env.HERMES_BRIDGE_HERMES_API_KEY;

  const merged = { ...raw, ...envOverrides };
  return configSchema.parse(merged) as BridgeConfig;
}
