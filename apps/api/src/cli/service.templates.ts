/**
 * The per-user service files `testate service install` writes (docs/decisions/2026-10-10-cli.md,
 * Q1). Both run `testate start --env-file <path>`, restart it when it fails, and leave it stopped
 * when it exits cleanly.
 */
import { LAUNCHD_LABEL } from "./paths.ts";

export type ServicePaths = { binary: string; envFile: string; log: string };

/** systemd splits ExecStart on spaces unless an argument is double-quoted. */
function quoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function systemdUnit(paths: ServicePaths): string {
  return [
    "# Written by testate service install. testate service uninstall removes it.",
    "[Unit]",
    "Description=Testate, git for your test database",
    "After=network-online.target",
    "",
    "[Service]",
    `ExecStart=${quoted(paths.binary)} start --env-file ${quoted(paths.envFile)}`,
    "Restart=on-failure",
    "RestartSec=2",
    "# Testate drains running jobs for up to 30 s on SIGTERM.",
    "TimeoutStopSec=45",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function launchdPlist(paths: ServicePaths): string {
  const args = [paths.binary, "start", "--env-file", paths.envFile];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    "<!-- Written by testate service install. testate service uninstall removes it. -->",
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key><string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${xml(arg)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    "  <!-- Restart after a crash, not after a clean stop. -->",
    "  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
    "  <key>ProcessType</key><string>Background</string>",
    `  <key>StandardOutPath</key><string>${xml(paths.log)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(paths.log)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}
