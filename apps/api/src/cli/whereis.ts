/**
 * `testate whereis`: every place this install keeps something, and whether it is there; with a
 * name, that one path alone, for scripts (docs/decisions/2026-10-10-cli.md, Q3).
 */
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { readEnvFile } from "./envfile.ts";
import { CliError, say, usage } from "./io.ts";
import type { CliContext } from "./io.ts";
import { currentOs, defaultDataDir, defaultEnvFile, launchdLog, serviceFile } from "./paths.ts";
import type { Env, Os } from "./paths.ts";

export type Place = { name: string; path: string | null; state: string };

/** True inside a `bun build --compile` binary; false under `bun dist/index.js` or a test. */
export function standalone(): boolean {
  return Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");
}

function there(path: string | null, yes: string, no: string): string {
  return path !== null && existsSync(path) ? yes : no;
}

function logPlace(os: Os, env: Env, dataDir: string | null): Place {
  if (os === "linux") return { name: "log", path: "journalctl --user -u testate", state: "" };
  if (os === "darwin") return { name: "log", path: launchdLog(env), state: "" };
  return { name: "log", path: dataDir === null ? null : join(dataDir, "logs"), state: "" };
}

/** The places, the data directory read from the env file when it names one. */
export function places(env: Env, os: Os, envFlag: string | undefined, version: string): Place[] {
  const envFile = envFlag ?? defaultEnvFile(env, os);
  const fromFile = envFile === null ? undefined : readEnvFile(envFile)?.get("TESTATE_DATA_DIR");
  const dataDir = fromFile ?? defaultDataDir(env, os);
  const unit = serviceFile(env, os);
  const binary = standalone() ? realpathSync(process.execPath) : null;
  return [
    { name: "env", path: envFile, state: there(envFile, "exists", "missing (run testate setup)") },
    { name: "data", path: dataDir, state: there(dataDir, "exists", "missing") },
    { name: "bin", path: binary, state: binary === null ? "not the standalone binary" : version },
    {
      name: "service",
      path: unit,
      state: os === "win32" ? "not on Windows" : there(unit, "installed", "not installed"),
    },
    logPlace(os, env, dataDir),
    // Pushed logs (#75): not in a backup, so this is where to copy them from (I7).
    {
      name: "ingest",
      path: dataDir === null ? null : join(dataDir, "logs-ingest"),
      state:
        dataDir === null ? "" : there(join(dataDir, "logs-ingest"), "exists", "nothing pushed yet"),
    },
  ];
}

/** One table row: name, state, then the path with the home directory shown as `~`. */
export function row(place: Place, env: Env): string {
  const home = env.HOME;
  const path = place.path ?? "-";
  const shown =
    home !== undefined && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  return `${place.name.padEnd(8)} ${place.state.padEnd(28)} ${shown}`;
}

export async function whereis(ctx: CliContext): Promise<void> {
  const { values, positionals } = usage(() =>
    parseArgs({
      args: ctx.args,
      options: { "env-file": { type: "string" } },
      allowPositionals: true,
      strict: true,
    })
  );
  const all = places(ctx.env, currentOs(), values["env-file"], ctx.version);
  const [name] = positionals;
  if (name === undefined) {
    for (const place of all) say(row(place, ctx.env));
    return;
  }
  const place = all.find((candidate) => candidate.name === name);
  if (place === undefined)
    throw new CliError(2, `whereis takes one of: ${all.map((p) => p.name).join(", ")}`);
  if (place.path === null) throw new CliError(1, `no ${name} on this machine: ${place.state}`);
  say(place.path);
}
