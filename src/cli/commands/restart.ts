import { restartService } from "../pm2-wrapper";

export async function handleRestart(): Promise<void> {
  try {
    await restartService();
    console.log("Restarted hermes-bridge");
  } catch (err: any) {
    console.error(`Error: Failed to restart service: ${err.message}`);
    process.exit(1);
  }
}
