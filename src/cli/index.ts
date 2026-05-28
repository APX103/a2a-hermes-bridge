#!/usr/bin/env node
import { handleInit } from "./commands/init";
import { handleStart } from "./commands/start";
import { handleStop } from "./commands/stop";
import { handleStatus } from "./commands/status";
import { handleRestart } from "./commands/restart";
import { handleLogs } from "./commands/logs";

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log("Usage: hermes-bridge <command> [options]");
  console.log("\nCommands:");
  console.log("  init              Initialize configuration (use --force to overwrite)");
  console.log("  start [-f path]   Start the service");
  console.log("  stop              Stop the service");
  console.log("  status            Show service status");
  console.log("  restart           Restart the service");
  console.log("  logs              Show service logs");
  console.log("\nOptions:");
  console.log("  -f, --config <path>  Path to config file");
  console.log("  -h, --help          Show this help message");
}

async function main(): Promise<void> {
  if (!command || command === "-h" || command === "--help") {
    printUsage();
    process.exit(0);
  }

  let configPath: string | undefined;

  // Parse -f / --config flag
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "-f" || args[i] === "--config") {
      if (args[i + 1]) {
        configPath = args[i + 1];
        break;
      }
    }
  }

  switch (command) {
    case "init":
      const force = args.includes("--force");
      await handleInit(force);
      break;
    case "start":
      await handleStart(configPath);
      break;
    case "stop":
      await handleStop();
      break;
    case "status":
      await handleStatus();
      break;
    case "restart":
      await handleRestart();
      break;
    case "logs":
      await handleLogs();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
