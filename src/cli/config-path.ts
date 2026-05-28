import { join, resolve, isAbsolute } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";

const DEFAULT_CONFIG_DIR = join(homedir(), ".hermes");
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.json");

export function getDefaultConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}

export function getDefaultConfigDir(): string {
  return DEFAULT_CONFIG_DIR;
}

export function getDefaultLogsDir(): string {
  return join(DEFAULT_CONFIG_DIR, "logs");
}

export function ensureConfigDir(): void {
  if (!existsSync(DEFAULT_CONFIG_DIR)) {
    mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
  }
}

export function ensureLogsDir(): void {
  const logsDir = getDefaultLogsDir();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

export function resolveConfigPath(userPath?: string): string {
  if (userPath) {
    const absolutePath = isAbsolute(userPath) ? userPath : resolve(userPath);
    return absolutePath;
  }
  if (existsSync(DEFAULT_CONFIG_PATH)) {
    return DEFAULT_CONFIG_PATH;
  }
  return "config.json"; // fallback for dev
}

export function configExists(): boolean {
  return existsSync(DEFAULT_CONFIG_PATH);
}