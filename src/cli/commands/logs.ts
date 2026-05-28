import { Tail } from "tail";
import * as path from "path";
import { getDefaultLogsDir } from "../config-path";

export async function handleLogs(): Promise<void> {
  const logsDir = getDefaultLogsDir();
  const outFile = path.join(logsDir, "out.log");
  const errorFile = path.join(logsDir, "error.log");

  try {
    const outTail = new Tail(outFile, {
      follow: true,
      fromBeginning: false,
      useWatchFile: true,
      logger: console,
    });

    const errTail = new Tail(errorFile, {
      follow: true,
      fromBeginning: false,
      useWatchFile: true,
      logger: console,
    });

    outTail.on("line", (data) => {
      console.log(data);
    });

    errTail.on("line", (data) => {
      console.log(data);
    });

    const handleError = (err: Error) => {
      console.error(`Error reading logs: ${err.message}`);
      process.exit(1);
    };

    outTail.on("error", handleError);
    errTail.on("error", handleError);

    process.on("SIGINT", () => {
      outTail.unwatch();
      errTail.unwatch();
      process.exit(0);
    });
  } catch (err: any) {
    console.error(`Error: Failed to read logs: ${err.message}`);
    console.error(`Make sure the service is running and logs exist at ${logsDir}`);
    process.exit(1);
  }
}
