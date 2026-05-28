import * as fs from "fs";
import { resolveConfigPath, getDefaultConfigPath, getDefaultLogsDir, ensureLogsDir } from "../config-path";
import { startService } from "../pm2-wrapper";
import { loadConfig } from "../../config";

export async function handleStart(configPath?: string): Promise<void> {
  const resolvedPath = resolveConfigPath(configPath);

  if (!fs.existsSync(resolvedPath)) {
    if (resolvedPath === getDefaultConfigPath()) {
      console.error("Error: Config not found at ~/.hermes/config.json");
      console.error("Run 'hermes-bridge init' to create one.");
    } else {
      console.error(`Error: Config not found at ${resolvedPath}`);
    }
    process.exit(1);
  }

  try {
    const configContent = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    loadConfig(configContent); // validate config format
  } catch (err: any) {
    console.error("Error: Invalid config format");
    console.error(err.message);
    process.exit(1);
  }

  ensureLogsDir();

  try {
    const pid = await startService(resolvedPath);
    console.log(`Started hermes-bridge${pid ? ` (pid: ${pid})` : ""}`);
  } catch (err: any) {
    console.error(`Error: Failed to start service: ${err.message}`);
    process.exit(1);
  }
}
