import { readFileSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "./config";
import type { BridgeConfig } from "./types";
import { HermesClient } from "./hermes-client";
import { createSessionStore } from "./session-store";
import { MessageHandler } from "./message-handler";
import { PlatformClient } from "./platform-client";
import { PullPoller } from "./pull/poller";
import { A2AProxyServer } from "./a2a-proxy";

function parseArgs(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) return args[i + 1];
    if (args[i].startsWith("--config=")) return args[i].split("=")[1];
  }
  return "config.json";
}

async function main() {
  const config: BridgeConfig = loadConfig(JSON.parse(readFileSync(resolve(parseArgs()), "utf-8")));
  console.log(`[START] a2a-hermes-bridge agent=${config.agent_name}`);
  console.log(`[CONFIG] platform_url=${config.platform_url}, hermes_url=${config.hermes_url}`);

  const hermesClient = new HermesClient({
    baseUrl: config.hermes_url,
    apiKey: config.hermes_api_key || undefined,
    model: config.hermes_model,
    timeoutMs: config.hermes_timeout_ms,
  });

  const startupHealth = await hermesClient.healthCheck();
  if (!startupHealth.ok) {
    console.error(`[FATAL] Hermes not reachable at ${config.hermes_url}: ${startupHealth.error}`);
    process.exit(1);
  }
  console.log(`[OK] Hermes connected`);

  const sessionStore = createSessionStore(config.session_store);
  const handler = new MessageHandler(hermesClient, sessionStore, config.context_mode);
  const platformClient = new PlatformClient(config);

  const poller = new PullPoller(platformClient, handler, {
    agentName: config.agent_name,
    pollIntervalMs: config.pull.poll_interval_ms,
    pollBatchSize: config.pull.poll_batch_size,
    heartbeatIntervalMs: config.pull.heartbeat_interval_ms,
    maxWorkers: config.pull.max_workers,
  });

  // Runtime health monitor
  const healthIntervalMs = Number(process.env.HERMES_HEALTH_INTERVAL_MS) || 30000;
  let lastHermesOk = true;
  let lastHermesError: string | undefined;
  let healthPaused = false;
  let shuttingDown = false;
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  const failureThreshold = 2;
  const successThreshold = 2;

  const healthTimer = setInterval(async () => {
    if (shuttingDown) return;
    const result = await hermesClient.healthCheck();
    lastHermesOk = result.ok;
    lastHermesError = result.error;
    if (!result.ok) {
      consecutiveSuccesses = 0;
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold && !healthPaused) {
        console.error(`[HEALTH] Hermes unreachable (${result.error}), pausing poller`);
        poller.stop();
        healthPaused = true;
      }
    } else {
      consecutiveFailures = 0;
      consecutiveSuccesses++;
      if (consecutiveSuccesses >= successThreshold && healthPaused) {
        console.log(`[HEALTH] Hermes recovered, resuming poller`);
        poller.start();
        healthPaused = false;
      }
    }
  }, healthIntervalMs);

  const a2aProxy = new A2AProxyServer({
    config,
    platformClient,
    sessionStore,
    getHealthStatus: () => ({
      targetOk: lastHermesOk,
      targetError: lastHermesError,
      pollerRunning: poller.isRunning(),
    }),
  });
  a2aProxy.start();

  const shutdown = async () => {
    console.log("[STOP] shutting down...");
    shuttingDown = true;
    clearInterval(healthTimer);
    poller.stop();
    a2aProxy.stop();
    await platformClient.deregister(config.agent_name).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    const result = await platformClient.registerAsPull({
      agentName: config.agent_name,
      description: config.agent_description,
      version: config.agent_version,
      contextMode: config.context_mode,
      agentCard: config.agent_card,
    });
    console.log(`[OK] Registered: ${result.name}`);
  } catch (err: any) {
    if (err.message?.includes("already registered")) {
      console.log(`[OK] Already registered: ${config.agent_name}`);
    } else {
      console.error(`[FATAL] Registration failed: ${err.message}`);
      process.exit(1);
    }
  }

  poller.start();
}

main().catch((err) => { console.error("[FATAL]", err); process.exit(1); });
