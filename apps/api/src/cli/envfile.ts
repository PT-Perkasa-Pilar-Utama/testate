/**
 * The `testate.env` file: KEY=VALUE lines, the same grammar the container, the systemd unit and
 * `deploy/pm2/ecosystem.config.cjs` read. It holds the sealing key, so it is written with mode
 * 600 in a directory with mode 700, outside the data directory (07-security).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Env } from "./paths.ts";

export type EnvValues = Map<string, string>;

const LINE = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/;
const QUOTED = /^(["'])(.*)\1$/;

/** Blank lines and `#` comments are skipped; one pair of surrounding quotes is removed. */
export function parseEnv(text: string): EnvValues {
  const values: EnvValues = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    values.set(match[1], match[2].replace(QUOTED, "$2"));
  }
  return values;
}

/** The file's values, or null when there is no file at `path`. */
export function readEnvFile(path: string): EnvValues | null {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : null;
}

/** A value with a space, a quote or a `#` is double-quoted, so `parseEnv` reads it back whole. */
function line(key: string, value: string): string {
  return /[\s"'#]/.test(value) ? `${key}="${value}"` : `${key}=${value}`;
}

/** Writes through a temporary file and a rename, so a crash never leaves half a key behind. */
export function writeEnvFile(path: string, values: EnvValues, header: readonly string[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = [...header.map((text) => `# ${text}`), ""];
  for (const [key, value] of values) body.push(line(key, value));
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${body.join("\n")}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

/**
 * What the server boots with: the file's values under the process environment, so a variable the
 * container, the systemd unit or pm2 already set wins (docs/decisions/2026-10-10-cli.md, Q3).
 */
export function withEnvFile(processEnv: Env, file: EnvValues | null): Env {
  return file === null ? processEnv : { ...Object.fromEntries(file), ...processEnv };
}
