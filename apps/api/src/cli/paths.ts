/**
 * Where the CLI keeps things on this machine (docs/decisions/2026-10-10-cli.md, Q3). Every
 * function takes the environment as an argument: `lib/config` stays the only reader of the
 * process environment, and a test passes its own.
 */
import { join } from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;
export type Os = "linux" | "darwin" | "win32";

export const LAUNCHD_LABEL = "io.testate.server";
export const UNIT_NAME = "testate.service";

/** The OS the CLI manages services for; anything else is treated as Linux. */
export function currentOs(): Os {
  if (process.platform === "darwin" || process.platform === "win32") return process.platform;
  return "linux";
}

function home(env: Env): string | null {
  return env.HOME ?? env.USERPROFILE ?? null;
}

/** An XDG base directory, or null when neither the variable nor HOME is set. */
function xdg(env: Env, variable: string, fallback: string): string | null {
  const set = env[variable];
  if (set !== undefined && set !== "") return set;
  const base = home(env);
  return base === null ? null : join(base, fallback);
}

export function configHome(env: Env, os: Os): string | null {
  return os === "win32" ? (env.APPDATA ?? null) : xdg(env, "XDG_CONFIG_HOME", ".config");
}

export function dataHome(env: Env, os: Os): string | null {
  return os === "win32" ? (env.LOCALAPPDATA ?? null) : xdg(env, "XDG_DATA_HOME", ".local/share");
}

function stateHome(env: Env): string | null {
  return xdg(env, "XDG_STATE_HOME", ".local/state");
}

/** `~/.config/testate/testate.env`, or null with no home directory to put it in. */
export function defaultEnvFile(env: Env, os: Os): string | null {
  const base = configHome(env, os);
  return base === null ? null : join(base, "testate", "testate.env");
}

/** `~/.local/share/testate`: the data directory `setup` proposes. */
export function defaultDataDir(env: Env, os: Os): string | null {
  const base = dataHome(env, os);
  return base === null ? null : join(base, "testate");
}

/** The per-user unit or plist; launchd only reads `~/Library/LaunchAgents`. None on Windows. */
export function serviceFile(env: Env, os: Os): string | null {
  if (os === "win32") return null;
  if (os === "darwin") {
    const base = home(env);
    return base === null ? null : join(base, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  }
  const base = configHome(env, os);
  return base === null ? null : join(base, "systemd", "user", UNIT_NAME);
}

/** The launchd service's log file. On Linux the user journal holds the log instead. */
export function launchdLog(env: Env): string | null {
  const base = stateHome(env);
  return base === null ? null : join(base, "testate", "testate.log");
}
