import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { E2E_DIR } from "../../playwright.config.ts";

const ROOT = join(E2E_DIR, "..");
const SERVER = "postgres://testate:testate@127.0.0.1:54320";

export function pgUrl(database: string): string {
  return `${SERVER}/${database}`;
}

/**
 * Runs statements on a compose database through `scripts/e2e-sql.ts`; Playwright runs under Node,
 * which has no driver here. The last statement's rows come back parsed.
 */
export function runSql<T>(database: string, statements: string[]): T {
  const result = spawnSync("bun", ["scripts/e2e-sql.ts", pgUrl(database)], {
    cwd: ROOT,
    input: JSON.stringify(statements),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`sql on ${database}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** A private database per test: nothing here touches the shared demo `shop`. */
export function createDatabase(name: string): void {
  runSql("postgres", [`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`, `CREATE DATABASE ${name}`]);
}

export function dropDatabase(name: string): void {
  runSql("postgres", [`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`]);
}

export type RowCount = { n: number };

export function countRows(database: string, table: string): number {
  const rows = runSql<RowCount[]>(database, [`SELECT count(*)::int AS n FROM ${table}`]);
  return rows[0]?.n ?? 0;
}

export type LockHolder = { release: () => void };

/**
 * Holds a SHARE lock on a table in its own session: readers still pass, so a snapshot works, but
 * every write waits. The statements share one connection (`max: 1` in the runner), so the
 * transaction stays open until the caller releases it.
 */
export function holdTableLock(database: string, table: string, seconds: number): LockHolder {
  const child = spawn("bun", ["scripts/e2e-sql.ts", pgUrl(database)], { cwd: ROOT, stdio: "pipe" });
  child.stdin.write(
    JSON.stringify(["BEGIN", `LOCK TABLE ${table} IN SHARE MODE`, `SELECT pg_sleep(${seconds})`])
  );
  child.stdin.end();
  return { release: () => child.kill("SIGKILL") };
}

/** Waits until the lock is visible to other sessions, so the caller does not race the spawn. */
export async function awaitLock(database: string, table: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = runSql<{ n: number }[]>(database, [
      `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
       WHERE c.relname = '${table}' AND l.mode = 'ShareLock' AND l.granted`,
    ]);
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no session ever locked ${table}`);
}

/** Runs SQL on a spawned instance's metadata database, for state the API offers no route to. */
export function runSqlite<T>(dataDir: string, statements: string[]): T {
  const result = spawnSync("bun", ["scripts/e2e-sqlite.ts", join(dataDir, "metadata.db")], {
    cwd: ROOT,
    input: JSON.stringify(statements),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`sqlite on ${dataDir}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** The host key an instance trusts for an adapter; missing means the connection never recorded one. */
export function hostKeyFingerprint(dataDir: string, adapterId: string): string {
  const rows = runSqlite<{ fingerprint: string }[]>(dataDir, [
    `SELECT fingerprint FROM known_host_keys WHERE adapter_id = '${adapterId}'`,
  ]);
  const first = rows[0];
  if (first === undefined) throw new Error(`no host key recorded for ${adapterId}`);
  return first.fingerprint;
}

/** Builds the typed workbook fixture and returns its path; the reader has to read its styles. */
export function typedWorkbook(): string {
  const target = join(E2E_DIR, "fixtures", "typed.xlsx");
  mkdirSync(dirname(target), { recursive: true });
  const result = spawnSync("bun", ["scripts/e2e-xlsx.ts", target], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`xlsx fixture: ${result.stderr}`);
  return target;
}
