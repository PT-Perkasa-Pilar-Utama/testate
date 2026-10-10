/**
 * `testate setup`: writes the env file the server and the service read (docs/decisions/2026-10-10-
 * cli.md). It keeps an existing sealing key, never prints the key or the password, and changes
 * nothing when run again with nothing new to say.
 */
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";

import { CliError, say, usage } from "./io.ts";
import type { CliContext } from "./io.ts";
import { readEnvFile, writeEnvFile } from "./envfile.ts";
import type { EnvValues } from "./envfile.ts";
import { currentOs, defaultDataDir, defaultEnvFile } from "./paths.ts";
import type { Env } from "./paths.ts";
import { ask, interactive, secret } from "./prompt.ts";

const KEY = "TESTATE_SECRETS_ACTIVE_KEY";
const DATA = "TESTATE_DATA_DIR";
const PORT = "PORT";
const PASSWORD = "TESTATE_ADMIN_PASSWORD";

export type SetupAnswers = { dataDir: string; port: string; password: string | null };
export type SetupPlan = { values: EnvValues; changed: boolean; keyGenerated: boolean };

/** One base64 32-byte key, the shape `scripts/generate-key.ts` prints. */
export function newKey(): string {
  return crypto.getRandomValues(new Uint8Array(32)).toBase64();
}

/** What the env file should hold: the existing file, an existing key kept, the answers on top. */
export function planSetup(
  existing: EnvValues,
  answers: SetupAnswers,
  makeKey: () => string
): SetupPlan {
  const values = new Map(existing);
  const keyGenerated = !existing.has(KEY);
  if (keyGenerated) values.set(KEY, makeKey());
  values.set(DATA, answers.dataDir);
  values.set(PORT, answers.port);
  if (answers.password !== null) values.set(PASSWORD, answers.password);
  const changed = [...values].some(([key, value]) => existing.get(key) !== value);
  return { values, changed, keyGenerated };
}

/** An absolute directory; `~/` expands to the home directory. */
export function dataDirFrom(answer: string, env: Env): string {
  const home = env.HOME ?? env.USERPROFILE;
  const expanded =
    answer.startsWith("~/") && home !== undefined ? join(home, answer.slice(2)) : answer;
  if (!isAbsolute(expanded))
    throw new CliError(1, `the data directory must be absolute: ${answer}`);
  return expanded;
}

export function portFrom(answer: string): string {
  const port = Number(answer);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new CliError(1, `the port must be a whole number from 1 to 65535: ${answer}`);
  return String(port);
}

type Flags = { dataDir: string | undefined; port: string | undefined };

/** With --yes an existing value stays; a flag that would change it is refused, not applied. */
function kept(
  existing: EnvValues,
  key: string,
  flag: string | undefined,
  fallback: string
): string {
  const current = existing.get(key);
  if (current !== undefined && flag !== undefined && flag !== current)
    throw new CliError(1, `${key} is already ${current}; edit the env file to change it`);
  return current ?? flag ?? fallback;
}

function unattended(existing: EnvValues, flags: Flags, env: Env, dataDir: string): SetupAnswers {
  const password = existing.has(PASSWORD) ? null : (env[PASSWORD] ?? "");
  if (password === "")
    throw new CliError(1, `--yes needs ${PASSWORD} in the environment for the first admin`);
  return {
    dataDir: dataDirFrom(kept(existing, DATA, flags.dataDir, dataDir), env),
    port: portFrom(kept(existing, PORT, flags.port, "7378")),
    password,
  };
}

async function newPassword(): Promise<string> {
  const first = await secret("First admin password (used once; you change it at first sign-in)");
  if (first === "") throw new CliError(1, "the admin password cannot be empty");
  if ((await secret("Again")) !== first) throw new CliError(1, "the two passwords differ");
  return first;
}

async function asked(existing: EnvValues, flags: Flags, env: Env, dataDir: string) {
  const dir = await ask("Data directory", existing.get(DATA) ?? flags.dataDir ?? dataDir);
  const port = await ask("Port", existing.get(PORT) ?? flags.port ?? "7378");
  const answers: SetupAnswers = {
    dataDir: dataDirFrom(dir, env),
    port: portFrom(port),
    password: null,
  };
  if (!existing.has(PASSWORD)) answers.password = await newPassword();
  return answers;
}

function report(path: string, plan: SetupPlan): void {
  say(`Wrote ${path} (mode 600)`);
  say(`  data directory  ${plan.values.get(DATA)}`);
  say(`  port            ${plan.values.get(PORT)}`);
  say(`  sealing key     ${plan.keyGenerated ? "generated" : "kept"} (not shown)`);
  say("Back up this file: without the key, the stored credentials cannot be read.");
  say("Next: testate service install   (or testate start, in the foreground)");
}

export async function setup(ctx: CliContext): Promise<void> {
  const { values: options } = usage(() =>
    parseArgs({
      args: ctx.args,
      options: {
        yes: { type: "boolean", short: "y" },
        "env-file": { type: "string" },
        "data-dir": { type: "string" },
        port: { type: "string" },
      },
      strict: true,
    })
  );
  const os = currentOs();
  const path = options["env-file"] ?? defaultEnvFile(ctx.env, os);
  const dataDir = defaultDataDir(ctx.env, os);
  if (path === null || dataDir === null)
    throw new CliError(1, "no home directory to write to; pass --env-file and --data-dir");
  if (options.yes !== true && !interactive())
    throw new CliError(1, `no terminal to ask on; run it with --yes and ${PASSWORD} set`);
  const existing = readEnvFile(path) ?? new Map<string, string>();
  const flags = { dataDir: options["data-dir"], port: options.port };
  const answers =
    options.yes === true
      ? unattended(existing, flags, ctx.env, dataDir)
      : await asked(existing, flags, ctx.env, dataDir);
  const plan = planSetup(existing, answers, newKey);
  if (!plan.changed) return say(`${path} is already set up; nothing changed.`);
  writeEnvFile(path, plan.values, [
    "Written by testate setup. Holds the sealing key: keep it, back it up.",
  ]);
  mkdirSync(answers.dataDir, { recursive: true, mode: 0o700 });
  report(path, plan);
}
