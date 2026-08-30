import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { E2E_DIR } from "../../playwright.config.ts";

const ROOT = join(E2E_DIR, "..");
const READY_MS = 30_000;

export type BootOverrides = { [name: string]: string };

/** The variables every boot needs; `bootEnv` fills them and takes overrides on top. */
export type BootEnv = {
  PORT: string;
  TESTATE_ENV: string;
  TESTATE_DATA_DIR: string;
  TESTATE_SECRETS_ACTIVE_KEY: string;
  TESTATE_ADMIN_PASSWORD: string;
  TESTATE_LOG_STDOUT: string;
};

export type Booted = {
  port: number;
  dir: string;
  base: string;
  stderr: () => string;
  /** Sends the signal and resolves with the exit code. */
  stop: (signal?: NodeJS.Signals) => Promise<number | null>;
};

export type Refusal = { code: number | null; stderr: string };

/** A fresh data dir per boot test; the suite keeps them under `.e2e/boot/`. */
export function bootDir(name: string): string {
  const dir = join(E2E_DIR, "boot", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

export function bootEnv(
  dir: string,
  key: string,
  port: number,
  extra: BootOverrides = {}
): BootEnv {
  return {
    PORT: String(port),
    TESTATE_ENV: "development",
    TESTATE_DATA_DIR: dir,
    TESTATE_SECRETS_ACTIVE_KEY: key,
    TESTATE_ADMIN_PASSWORD: "boot-admin-password-1",
    TESTATE_LOG_STDOUT: "false",
    ...extra,
  };
}

type Child = ReturnType<typeof spawn>;
type Started = { child: Child; stderr: () => string };

function start(env: BootEnv, entry: string): Started {
  let text = "";
  const child = spawn("bun", [entry], { cwd: ROOT, env: { ...process.env, ...env } });
  child.stderr.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  child.stdout.on("data", () => undefined);
  return { child, stderr: () => text };
}

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).status === 204;
  } catch {
    return false;
  }
}

/** `entry` picks the source or the built bundle; `readyPath` follows the base path. */
export type BootOptions = { entry?: string; readyPath?: string };

/** Spawns the API and resolves when it answers `/health/live`; a refusal rejects. */
export async function bootApi(env: BootEnv, options: BootOptions = {}): Promise<Booted> {
  const { child, stderr } = start(env, options.entry ?? "apps/api/src/index.ts");
  const port = Number(env.PORT);
  const base = `http://127.0.0.1:${port}`;
  let exited: number | null = null;
  child.on("exit", (code) => {
    exited = code;
  });
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`boot exited ${exited}: ${stderr()}`);
    if (await reachable(`${base}${options.readyPath ?? "/api/v1/health/live"}`)) {
      return {
        port,
        dir: env.TESTATE_DATA_DIR,
        base,
        stderr,
        stop: async (signal = "SIGTERM") => {
          if (exited !== null) return exited;
          child.kill(signal);
          return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGKILL");
  throw new Error(`boot never became ready: ${stderr()}`);
}

/** Spawns the API expecting it to refuse; resolves with its exit code and stderr. */
export async function bootFails(env: BootEnv): Promise<Refusal> {
  const { child, stderr } = start(env, "apps/api/src/index.ts");
  const code = await new Promise<number | null>((resolve) => {
    child.on("exit", (value) => resolve(value));
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, READY_MS);
  });
  return { code, stderr: stderr() };
}

export type BootEvent = {
  op: {
    name: string;
    migrations_applied: string[];
    sealed_re_sealed: number;
    sealed_unreadable: number;
    pre_migration_copy: boolean;
    jobs_interrupted: number;
    jobs_head_unknown: number;
    admin_password_reset: boolean;
  };
};

/** The last `boot` event a run wrote to its daily log file. */
export function bootEvents(dir: string): BootEvent[] {
  const logs = join(dir, "logs");
  if (!existsSync(logs)) return [];
  return readdirSync(logs)
    .flatMap((name) => readFileSync(join(logs, name), "utf8").split("\n"))
    .filter((line) => line.includes('"name":"boot"'))
    .map((line) => JSON.parse(line));
}

export function preMigrationCopies(dir: string): string[] {
  const run = join(dir, "run");
  if (!existsSync(run)) return [];
  return readdirSync(run)
    .filter((name) => name.startsWith("metadata-") && name.endsWith(".db"))
    .sort();
}
