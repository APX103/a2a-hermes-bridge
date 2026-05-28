import { writeFileSync } from "fs";
import { join } from "path";
import { promptForConfig, promptOverwrite, InitAnswers } from "../prompts";
import { getDefaultConfigPath, ensureConfigDir, configExists } from "../config-path";
import type { BridgeConfig } from "../../types";

const DEFAULT_CONFIG = {
  agent_name: "hermes",
  agent_description: "Hermes AI Agent - self-improving AI with tools, skills, and memory",
  agent_version: "1.0.0",
  hermes_timeout_ms: 120000,
  context_mode: "stateless" as const,
  pull: {
    poll_interval_ms: 2000,
    poll_batch_size: 10,
    heartbeat_interval_ms: 15000,
    max_workers: 4,
  },
  session_store: {
    type: "sqlite" as const,
    path: join(process.env.HOME || "", ".hermes", "sessions.db"),
  },
  a2a_proxy_port: 3000,
  known_agents: [] as string[],
  agent_card: {
    skills: [
      { id: "chat", name: "Chat", description: "General conversation with Hermes agent" },
    ],
    capabilities: { streaming: true },
  },
};

export async function handleInit(force: boolean = false): Promise<void> {
  const configPath = getDefaultConfigPath();

  if (configExists() && !force) {
    const shouldOverwrite = await promptOverwrite(configPath);
    if (!shouldOverwrite) {
      console.log("Init cancelled.");
      return;
    }
  }

  console.log("\nWelcome to a2a-hermes-bridge setup!\n");

  const answers: InitAnswers = await promptForConfig();

  const config: BridgeConfig = {
    ...DEFAULT_CONFIG,
    platform_url: answers.platform_url,
    hermes_url: answers.hermes_url,
    hermes_api_key: answers.hermes_api_key,
    hermes_model: answers.hermes_model,
  };

  ensureConfigDir();
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`\n✓ Config created at: ${configPath}`);
  console.log("\nNext steps:");
  console.log("  Run 'hermes-bridge start' to start the service\n");
}
