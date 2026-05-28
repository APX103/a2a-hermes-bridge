import * as pm2 from "pm2";
import { join } from "path";
import { getDefaultConfigDir, getDefaultLogsDir } from "./config-path";

const APP_NAME = "hermes-bridge";

export interface Pm2Status {
  running: boolean;
  uptime: number | null;
  restarts: number;
  pid: number | null;
  memory?: number;
  cpu?: number;
}

// Extended start options that PM2 supports but types don't include
interface ExtendedStartOptions {
  name: string;
  script: string;
  args?: string | string[];
  cwd?: string;
  instances?: number;
  exec_mode?: string;
  autorestart?: boolean;
  max_restarts?: number;
  min_uptime?: number | string;
  env?: Record<string, string>;
  log_file?: string;
  out_file?: string;
  error_file?: string;
  log_date_format?: string;
  merge_logs?: boolean;
  kill_timeout?: number;
  listen_timeout?: number;
}

// PM2 callbacks have inconsistent signatures
interface Pm2Proc {
  pid?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
  };
  monit?: {
    memory?: number;
    cpu?: number;
  };
}

type Callback<T = void> = (err?: Error | null, result?: T) => void;
type ProcCallback = (err?: Error | null, proc?: Pm2Proc[]) => void;
type DescribeCallback = (err?: Error | null, list?: Pm2Proc[]) => void;

// Connect and disconnect with proper typing
function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
}

function disconnect(): Promise<void> {
  return new Promise((resolve) => {
    (pm2.disconnect as any)(() => resolve());
  });
}

export async function startService(configPath: string): Promise<number | null> {
  await connect();
  const logsDir = getDefaultLogsDir();

  return new Promise((resolve, reject) => {
    (pm2.start as any)(
      {
        name: APP_NAME,
        script: join(__dirname, "../index.js"),
        args: ["--config", configPath],
        cwd: process.cwd(),
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        max_restarts: 10,
        min_uptime: "10s",
        env: { NODE_ENV: "production" },
        log_file: join(logsDir, "combined.log"),
        out_file: join(logsDir, "out.log"),
        error_file: join(logsDir, "error.log"),
        log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        merge_logs: true,
        kill_timeout: 5000,
        listen_timeout: 10000,
      } as ExtendedStartOptions,
      ((err: Error | null, proc: Pm2Proc[] | undefined) => {
        disconnect();
        if (err) {
          return reject(err);
        }
        resolve(proc?.[0]?.pid || null);
      }) as ProcCallback
    );
  });
}

export async function stopService(): Promise<void> {
  await connect();
  return new Promise((resolve, reject) => {
    (pm2.stop as any)(APP_NAME, ((err: Error | null) => {
      disconnect();
      if (err) return reject(err);
      resolve();
    }) as Callback);
  });
}

export async function deleteService(): Promise<void> {
  await connect();
  return new Promise((resolve, reject) => {
    (pm2.delete as any)(APP_NAME, ((err: Error | null) => {
      disconnect();
      if (err) return reject(err);
      resolve();
    }) as Callback);
  });
}

export async function getStatus(): Promise<Pm2Status> {
  await connect();
  return new Promise((resolve, reject) => {
    (pm2.describe as any)(APP_NAME, ((err: Error | null, list: Pm2Proc[] | undefined) => {
      disconnect();
      if (err) return reject(err);
      const proc = list?.[0];
      if (!proc) {
        return resolve({ running: false, uptime: null, restarts: 0, pid: null });
      }
      resolve({
        running: proc.pm2_env?.status === "online",
        uptime: proc.pm2_env?.pm_uptime || null,
        restarts: proc.pm2_env?.restart_time || 0,
        pid: proc.pid || null,
        memory: proc.monit?.memory,
        cpu: proc.monit?.cpu,
      });
    }) as DescribeCallback);
  });
}

export async function restartService(): Promise<void> {
  await connect();
  return new Promise((resolve, reject) => {
    (pm2.restart as any)(APP_NAME, ((err: Error | null) => {
      disconnect();
      if (err) return reject(err);
      resolve();
    }) as Callback);
  });
}

export async function getLogs(lines: number = 100): Promise<{
  out: string;
  err: string;
}> {
  await connect();
  return new Promise((resolve, reject) => {
    ((pm2 as any).logs)(APP_NAME, lines, ((err: Error | null, logs: any) => {
      disconnect();
      if (err) return reject(err);
      const out =
        logs
          ?.map((l: any) => l.data)
          .filter((d: any) => d?.type === "out")
          .map((d: any) => d.stream)
          .join("") || "";
      const errLog =
        logs
          ?.map((l: any) => l.data)
          .filter((d: any) => d?.type === "err")
          .map((d: any) => d.stream)
          .join("") || "";
      resolve({ out, err: errLog });
    }) as Callback);
  });
}

export async function flushLogs(): Promise<void> {
  await connect();
  return new Promise((resolve, reject) => {
    (pm2.flush as any)(APP_NAME, ((err: Error | null) => {
      disconnect();
      if (err) return reject(err);
      resolve();
    }) as Callback);
  });
}

export function formatUptime(ms: number | null): string {
  if (!ms) return "N/A";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatMemory(bytes: number | undefined): string {
  if (!bytes) return "N/A";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}
