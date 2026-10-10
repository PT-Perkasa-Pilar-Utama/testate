/**
 * `testate service`: a per-user systemd unit or LaunchAgent that keeps `testate start` running
 * (docs/decisions/2026-10-10-cli.md, Q1). Testate is not its own supervisor: the OS restarts it,
 * starts it at boot and keeps its log. Commands go through a runner so a test can record them.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { CliError, say, usage } from "./io.ts";
import type { CliContext } from "./io.ts";
import {
  currentOs,
  defaultEnvFile,
  LAUNCHD_LABEL,
  launchdLog,
  serviceFile,
  UNIT_NAME,
} from "./paths.ts";
import type { Env, Os } from "./paths.ts";
import { launchdPlist, systemdUnit } from "./service.templates.ts";
import { standalone } from "./whereis.ts";

export type RunResult = { code: number; out: string; err: string };
/** Runs a command; `inherit` hands it the terminal, for `status` and `logs`. */
export type Runner = (command: string[], inherit?: boolean) => RunResult;

export type ServiceDeps = { os: Os; run: Runner; binary: string | null; uid: number };

export const spawnRunner: Runner = (command, inherit = false) => {
  const io = inherit ? "inherit" : "pipe";
  const result = Bun.spawnSync(command, { stdout: io, stderr: io, stdin: "inherit" });
  return {
    code: result.exitCode,
    out: String(result.stdout ?? ""),
    err: String(result.stderr ?? ""),
  };
};

function systemctl(...args: string[]): string[] {
  return ["systemctl", "--user", ...args];
}

function target(deps: ServiceDeps): string {
  return `gui/${deps.uid}/${LAUNCHD_LABEL}`;
}

/** systemctl --user's answer when this shell has no user session to talk to. */
const NO_SESSION = /connect to bus|XDG_RUNTIME_DIR/;
const SESSION_HINT =
  "This shell has no user session (ssh -T, su, or a script). Run it from a normal login, or run " +
  "`sudo loginctl enable-linger $USER` and set XDG_RUNTIME_DIR=/run/user/$(id -u) first.";

/** Runs each command in turn and stops at the first failure, naming it. */
function steps(deps: ServiceDeps, commands: string[][]): void {
  for (const command of commands) {
    const result = deps.run(command);
    if (result.code === 0) continue;
    const said = (result.err || result.out).trim();
    const hint = NO_SESSION.test(said) ? `\n${SESSION_HINT}` : "";
    throw new CliError(1, `${command.join(" ")} failed: ${said}${hint}`);
  }
}

/** On Linux a user service starts at boot only with lingering on; try, else say how. */
function linger(deps: ServiceDeps, env: Env): void {
  const user = env.USER ?? env.LOGNAME ?? "";
  if (deps.run(["loginctl", "show-user", user, "-p", "Linger"]).out.includes("Linger=yes")) return;
  if (deps.run(["loginctl", "enable-linger", user]).code === 0) return;
  say(`To start Testate at boot, before you log in, run once: sudo loginctl enable-linger ${user}`);
}

function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

function install(deps: ServiceDeps, env: Env, envFile: string, unit: string): void {
  if (deps.binary === null)
    throw new CliError(1, "service install needs the standalone testate binary, not bun");
  if (!existsSync(envFile))
    throw new CliError(1, `no env file at ${envFile}; run testate setup first`);
  const log = launchdLog(env) ?? "/tmp/testate.log";
  const paths = { binary: deps.binary, envFile, log };
  if (deps.os === "darwin") {
    mkdirSync(dirname(log), { recursive: true });
    const changed = writeIfChanged(unit, launchdPlist(paths));
    deps.run(["launchctl", "bootout", target(deps)]);
    steps(deps, [["launchctl", "bootstrap", `gui/${deps.uid}`, unit]]);
    return say(`${changed ? "Installed" : "Already installed"}: ${unit}\nLog: ${log}`);
  }
  const changed = writeIfChanged(unit, systemdUnit(paths));
  steps(deps, [systemctl("daemon-reload"), systemctl("enable", "--now", UNIT_NAME)]);
  linger(deps, env);
  say(`${changed ? "Installed" : "Already installed"}: ${unit}\nLog: journalctl --user -u testate`);
}

function uninstall(deps: ServiceDeps, unit: string): void {
  if (!existsSync(unit)) return say("No service installed; nothing to remove.");
  if (deps.os === "darwin") deps.run(["launchctl", "bootout", target(deps)]);
  else deps.run(systemctl("disable", "--now", UNIT_NAME));
  rmSync(unit);
  if (deps.os === "linux") deps.run(systemctl("daemon-reload"));
  say(`Removed ${unit}. The env file and the data directory are untouched.`);
}

const PASS = ["start", "stop", "status", "logs"] as const;
type Pass = (typeof PASS)[number];

/** What `start`, `stop`, `status` and `logs` run on each OS. */
function passThrough(deps: ServiceDeps, action: Pass, follow: boolean, log: string): string[] {
  const darwin: Record<Pass, string[]> = {
    start: ["launchctl", "kickstart", target(deps)],
    stop: ["launchctl", "kill", "SIGTERM", target(deps)],
    status: ["launchctl", "print", target(deps)],
    logs: ["tail", "-n", "200", ...(follow ? ["-f"] : []), log],
  };
  const linux: Record<Pass, string[]> = {
    start: systemctl("start", UNIT_NAME),
    stop: systemctl("stop", UNIT_NAME),
    status: systemctl("status", "--no-pager", UNIT_NAME),
    logs: [
      "journalctl",
      "--user",
      "-u",
      "testate",
      "-n",
      "200",
      ...(follow ? ["-f"] : ["--no-pager"]),
    ],
  };
  return (deps.os === "darwin" ? darwin : linux)[action];
}

/** Restarts the installed service after an update; false when none is installed. */
export function restartService(deps: ServiceDeps, env: Env): boolean {
  const unit = serviceFile(env, deps.os);
  if (unit === null || !existsSync(unit)) return false;
  const command =
    deps.os === "darwin"
      ? ["launchctl", "kickstart", "-k", target(deps)]
      : systemctl("restart", UNIT_NAME);
  steps(deps, [command]);
  return true;
}

const ACTIONS = ["install", "uninstall", ...PASS];

type ServiceArgs = { action: string; envFile: string | undefined; follow: boolean };

function serviceArgs(args: string[]): ServiceArgs {
  const { values, positionals } = usage(() =>
    parseArgs({
      args,
      options: { "env-file": { type: "string" }, follow: { type: "boolean", short: "f" } },
      allowPositionals: true,
      strict: true,
    })
  );
  const [action] = positionals;
  if (action === undefined || !ACTIONS.includes(action))
    throw new CliError(2, `service takes one of: ${ACTIONS.join(", ")}`);
  return { action, envFile: values["env-file"], follow: values.follow === true };
}

/** start, stop, status and logs: handed to systemctl, launchctl or tail, with the terminal. */
function managed(deps: ServiceDeps, env: Env, unit: string, parsed: ServiceArgs): void {
  if (!existsSync(unit)) throw new CliError(1, "no service installed; run testate service install");
  const pass = PASS.find((candidate) => candidate === parsed.action) ?? "status";
  const result = deps.run(passThrough(deps, pass, parsed.follow, launchdLog(env) ?? ""), true);
  process.exitCode = result.code;
}

export async function serviceWith(ctx: CliContext, deps: ServiceDeps): Promise<void> {
  const parsed = serviceArgs(ctx.args);
  const unit = serviceFile(ctx.env, deps.os);
  if (unit === null) throw new CliError(1, "testate service is not available on Windows yet");
  if (parsed.action === "uninstall") return uninstall(deps, unit);
  if (parsed.action !== "install") return managed(deps, ctx.env, unit, parsed);
  const envFile = parsed.envFile ?? defaultEnvFile(ctx.env, deps.os);
  if (envFile === null) throw new CliError(1, "no home directory; pass --env-file");
  return install(deps, ctx.env, envFile, unit);
}

export function serviceDeps(): ServiceDeps {
  return {
    os: currentOs(),
    run: spawnRunner,
    binary: standalone() ? realpathSync(process.execPath) : null,
    uid: process.getuid?.() ?? 0,
  };
}

export async function service(ctx: CliContext): Promise<void> {
  return serviceWith(ctx, serviceDeps());
}
