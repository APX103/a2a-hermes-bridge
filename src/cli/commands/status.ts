import { getStatus, formatUptime, formatMemory } from "../pm2-wrapper";
import { getDefaultConfigPath } from "../config-path";

export async function handleStatus(): Promise<void> {
  try {
    const status = await getStatus();
    const configPath = getDefaultConfigPath();

    console.log(`Status: ${status.running ? "running" : "stopped"}`);
    if (status.running) {
      console.log(`Uptime: ${formatUptime(status.uptime)}`);
      console.log(`Restarts: ${status.restarts}`);
      console.log(`Pid: ${status.pid || "N/A"}`);
      console.log(`Memory: ${formatMemory(status.memory)}`);
      if (status.cpu !== undefined) {
        console.log(`CPU: ${status.cpu.toFixed(2)}%`);
      }
    }
    console.log(`Config: ${configPath}`);
  } catch (err: any) {
    console.error(`Error: Failed to get status: ${err.message}`);
    process.exit(1);
  }
}
