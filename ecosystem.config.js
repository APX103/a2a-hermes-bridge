module.exports = {
  apps: [
    {
      name: "a2a-hermes-bridge",
      script: "./dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      log_file: "./logs/bridge-combined.log",
      out_file: "./logs/bridge-out.log",
      error_file: "./logs/bridge-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Graceful shutdown: bridge deregisters on SIGINT
      // pm2 sends SIGINT then SIGKILL after kill_timeout
      shutdown_with_message: false,
    },
  ],
};
