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

export type AdminSession = { base: string; cookie: string };

const FIRST = "boot-admin-password-1";
const FINAL = "boot-admin-password-2";

type PasswordChange = { current: string; next: string };

async function post(session: AdminSession, path: string, body: PasswordChange): Promise<Response> {
  return fetch(`${session.base}/api/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Testate-Request": "1",
      cookie: session.cookie,
    },
    body: JSON.stringify(body),
  });
}

async function login(base: string, password: string): Promise<string | null> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Testate-Request": "1" },
    body: JSON.stringify({ username: "admin", password }),
  });
  if (!response.ok) return null;
  return (response.headers.getSetCookie().at(0) ?? "").split(";")[0] ?? "";
}

/**
 * Signs the bootstrap admin in. A fresh instance forces the temporary password out of the way
 * (09 §9.2); an instance this suite already visited answers to the rotated one.
 */
export async function adminSession(base: string): Promise<AdminSession> {
  const rotated = await login(base, FINAL);
  if (rotated !== null) return { base, cookie: rotated };
  const cookie = await login(base, FIRST);
  if (cookie === null) throw new Error(`boot login refused both passwords`);
  const session = { base, cookie };
  const changed = await post(session, "auth/password", { current: FIRST, next: FINAL });
  if (changed.status !== 204) throw new Error(`boot password: ${changed.status}`);
  return session;
}

/** Seals two S3 credentials in the settings, so the next boot has something to open. */
export async function sealS3Credentials(session: AdminSession): Promise<void> {
  const response = await fetch(`${session.base}/api/v1/settings`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "X-Testate-Request": "1",
      cookie: session.cookie,
    },
    body: JSON.stringify({
      store: {
        s3: {
          bucket: "snapshots",
          prefix: "boot",
          region: null,
          endpoint: "http://minio.sit.internal:9000",
          virtual_hosted: false,
          access_key_id: "AKIABOOT",
          secret_access_key: "boot-secret",
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`seal settings: ${response.status} ${await response.text()}`);
}

export type Reply<T> = { status: number; json: T };

/** What a request body may hold: JSON, or nothing at all. */
export type RequestBody =
  | string
  | number
  | boolean
  | null
  | RequestBody[]
  | { [key: string]: RequestBody };

/** One request on a spawned instance as the signed-in admin; the caller names the payload type. */
export async function call<T>(
  session: AdminSession,
  method: string,
  path: string,
  body?: RequestBody
): Promise<Reply<T>> {
  const response = await fetch(`${session.base}/api/v1/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Testate-Request": "1",
      cookie: session.cookie,
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  // A 204 answers with no body; every other route answers JSON.
  const json: T = text === "" ? JSON.parse("null") : JSON.parse(text);
  return { status: response.status, json };
}

export type PostgresDraft = {
  kind: "database";
  engine: "postgres";
  name: string;
  config: { host: string; port: number; database: string; user: string };
  secrets: { password: string };
};

/** A draft against the compose Postgres, with the host under test. */
export function draftFor(host: string, name = "probe"): PostgresDraft {
  return {
    kind: "database",
    engine: "postgres",
    name,
    config: { host, port: 54320, database: "shop", user: "testate" },
    secrets: { password: "testate" },
  };
}

/** A project with one Postgres adapter on a spawned instance; loopback is lifted first. */
export async function seedProject(session: AdminSession, slug: string): Promise<string> {
  await call(session, "PATCH", "settings", { netguard: { deny: [] } });
  const project = await call<unknown>(session, "POST", "projects", { slug, name: slug });
  if (project.status !== 201) throw new Error(`project ${slug}: ${JSON.stringify(project.json)}`);
  const created = await call<{ data: { adapter: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/adapters`,
    draftFor("127.0.0.1", "shop")
  );
  if (created.status !== 201) throw new Error(`adapter: ${JSON.stringify(created.json)}`);
  return created.json.data.adapter.id;
}

/** Waits until the instance runs no job, so the next step starts on an idle dispatcher. */
export async function waitIdle(session: AdminSession): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const jobs = await call<{ data: unknown[] }>(
      session,
      "GET",
      "jobs?status=running&status=queued&limit=50"
    );
    if (jobs.json.data.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the instance never went idle");
}

/**
 * Starts a snapshot and kills the instance while the job runs, so the next boot finds a `running`
 * row. A snapshot of the demo database is quick, so this retries until it catches one mid-flight.
 */
export async function killDuringSnapshot(
  session: AdminSession,
  booted: Booted,
  slug: string,
  adapterId: string
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const started = await call<{ data: { job: { id: string } } }>(
      session,
      "POST",
      `projects/${slug}/states`,
      { name: `killed-${attempt}`, adapter_ids: [adapterId] }
    );
    const jobId = started.json.data.job.id;
    for (let poll = 0; poll < 60; poll += 1) {
      const job = await call<{ data: { status: string } }>(session, "GET", `jobs/${jobId}`);
      if (job.json.data.status === "running") {
        await booted.stop("SIGKILL");
        return jobId;
      }
      if (job.json.data.status !== "queued") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("no snapshot job stayed running long enough to interrupt");
}
