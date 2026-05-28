import { stopService, deleteService } from "../pm2-wrapper";

export async function handleStop(): Promise<void> {
  try {
    await stopService();
    await deleteService();
    console.log("Stopped hermes-bridge");
  } catch (err: any) {
    console.error(`Error: Failed to stop service: ${err.message}`);
    process.exit(1);
  }
}
