// Testate under pm2. The binary is the script, with no interpreter:
//
//   pm2 start deploy/pm2/ecosystem.config.cjs
//
// Reads ./testate.env (or TESTATE_ENV_FILE), the same file the systemd unit and the container
// use; set TESTATE_DATA_DIR in it. Parsed here in a few lines, so nothing depends on which pm2
// version supports an env file. Decisions: docs/decisions/2026-10-10-native-binaries.md.
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/** KEY=VALUE lines; blank lines and # comments skipped; one pair of surrounding quotes removed. */
function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null) continue;
    env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

module.exports = {
  apps: [
    {
      name: "testate",
      script: process.env.TESTATE_BIN ?? "testate",
      interpreter: "none",
      env: readEnv(resolve(process.env.TESTATE_ENV_FILE ?? "testate.env")),
      // Testate drains running jobs for up to 30 s on SIGTERM.
      kill_timeout: 45_000,
      autorestart: true,
    },
  ],
};
