# A2A Hermes Bridge CLI Tool Design

**Date:** 2026-05-28
**Topic:** npm global CLI tool for a2a-hermes-bridge

## Overview

Transform a2a-hermes-bridge from a local Node.js application to a globally installable npm CLI tool. Users can install via `npm i -g a2a-hermes-bridge` and manage the service through subcommands (init, start, stop, status, restart, logs).

## Requirements

1. Global installation via npm
2. Config location: `~/.hermes/config.json` by default
3. `-f` flag to specify custom config path
4. Interactive config generation via `init` command
5. Process management via PM2 (bundled as dependency)
6. Start/stop/status/restart/logs subcommands

## File Structure

```
bin/
  hermes-bridge          # CLI entry point (shebang → node)
src/
  index.ts               # Existing service entry (unchanged)
  config.ts              # Existing config loader (unchanged)
  cli/
    index.ts             # CLI main entry, parses subcommands
    commands/
      init.ts            # Interactive config generation
      start.ts           # Start service
      stop.ts            # Stop service
      status.ts          # View status
      restart.ts         # Restart service
      logs.ts            # View logs
    pm2-wrapper.ts       # PM2 operations wrapper
    config-path.ts       # Config path resolution
    prompts.ts           # Interactive input wrapper
```

## Configuration Path Logic

**Priority order:**
1. `-f` flag (user-specified path)
2. `~/.hermes/config.json` (default)
3. `config.json` (current directory, dev compatibility)

**Config resolution code:**
```typescript
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".hermes");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, "config.json");

function resolveConfigPath(userPath?: string): string {
  if (userPath) return userPath;
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH;
  return "config.json"; // fallback for dev
}
```

**Missing config error:**
```
Error: Config not found at ~/.hermes/config.json
Run 'hermes-bridge init' to create one.
```

## Init Command (hermes-bridge init)

**Interactive flow using `prompts` library:**

```bash
$ hermes-bridge init

Welcome to a2a-hermes-bridge setup!

? Platform URL: http://localhost:18090
? Hermes URL: http://localhost:8642
? Hermes Model: hermes-agent
? Hermes API Key (optional): [press Enter to skip]

Config created at: /Users/xxx/.hermes/config.json

Next steps:
  Run 'hermes-bridge start' to start the service
```

**Fields:**
- `platform_url` (required, must be valid URL)
- `hermes_url` (required, must be valid URL)
- `hermes_model` (required, non-empty)
- `hermes_api_key` (optional, can be empty)

**Other fields:** Use defaults from existing code.

**Overwrite protection:**
```
Config already exists at ~/.hermes/config.json.
Use 'hermes-bridge init --force' to overwrite.
```

## PM2 Wrapper

**Dynamic PM2 config generation:**

```javascript
{
  name: "hermes-bridge",
  script: require.resolve("a2a-hermes-bridge/dist/index.js"),
  args: ["--config", configPath],
  cwd: process.cwd(),
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  max_restarts: 10,
  min_uptime: "10s",
  env: { NODE_ENV: "production" },
  log_file: path.join(DEFAULT_CONFIG_DIR, "logs/combined.log"),
  out_file: path.join(DEFAULT_CONFIG_DIR, "logs/out.log"),
  error_file: path.join(DEFAULT_CONFIG_DIR, "logs/error.log"),
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  merge_logs: true,
}
```

**PM2 operations:**
- `start(configPath)` → Start PM2 process, return pid
- `stop()` → Stop PM2 process
- `status()` → Return `{ running: boolean, uptime: number | null, restarts: number, pid: number | null }`
- `restart()` → Restart PM2 process
- `logs()` → Stream real-time logs (tail -f equivalent)

## Subcommand Behavior

**`hermes-bridge start [-f ...]`**
1. Resolve config path
2. Check config exists
3. Validate config format
4. Start PM2 process
5. Output: `Started hermes-bridge (pid: 12345)`

**`hermes-bridge stop`**
1. Stop PM2 process
2. Output: `Stopped hermes-bridge`

**`hermes-bridge status`**
1. Query PM2 process status
2. Output:
   ```
   Status: running
   Uptime: 2h 15m
   Restarts: 0
   Pid: 12345
   Config: ~/.hermes/config.json
   ```

**`hermes-bridge restart`**
1. Restart PM2 process
2. Output: `Restarted hermes-bridge`

**`hermes-bridge logs`**
1. Stream logs from `~/.hermes/logs/out.log` and `error.log`
2. Use process.exit() on Ctrl+C

**`hermes-bridge init [--force]`**
1. Check existing config (prompt for overwrite if exists and no --force)
2. Interactive prompts for required fields
3. Write `~/.hermes/config.json`
4. Output config location and next steps

## Error Handling

**Config not found:**
```
Error: Config not found at ~/.hermes/config.json
Run 'hermes-bridge init' to create one.
```

**Invalid config format:**
```
Error: Invalid config: "platform_url" is required
```

**Hermes connection failed:**
```
Error: Hermes not reachable at http://localhost:8642
```

**PM2 operation failed:**
```
Error: Failed to start service: [PM2 error details]
```

## Logging

**Log directory:** `~/.hermes/logs/`

**Files:**
- `out.log` → stdout
- `error.log` → stderr
- `combined.log` → merged

## package.json Changes

```json
{
  "bin": {
    "hermes-bridge": "./bin/hermes-bridge"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts --config config.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "uuid": "^10.0.0",
    "zod": "^3.25.76",
    "pm2": "^5.4.0",
    "prompts": "^2.4.0"
  },
  ...
}
```

**Notes:**
- `prepare` script runs `npm run build` on install, ensuring `dist/` exists
- PM2 bundled as dependency (won't conflict with user's global PM2)
- `prompts` for interactive CLI input

## Usage Flow

```bash
# Install globally
npm i -g a2a-hermes-bridge

# Initial setup
hermes-bridge init
# → Prompts for platform_url, hermes_url, hermes_model, hermes_api_key

# Start service
hermes-bridge start
# → Started hermes-bridge (pid: 12345)

# Check status
hermes-bridge status
# → Status: running, Uptime: 2h 15m, ...

# View logs
hermes-bridge logs

# Restart
hermes-bridge restart

# Stop
hermes-bridge stop

# Update
npm update -g a2a-hermes-bridge
hermes-bridge restart
```

## Dependencies

- **pm2** (^5.4.0) - Process management
- **prompts** (^2.4.0) - Interactive CLI prompts

Both added to `dependencies` (not devDependencies) since they're needed at runtime.