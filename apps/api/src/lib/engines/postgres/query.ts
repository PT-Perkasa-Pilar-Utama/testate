import type { SQL } from "bun";
import type { JsonValue } from "@testate/shared";
import * as v from "valibot";

import { EngineError, rowText } from "../types.ts";
import type { EngineQuery, QueryOptions, QueryResult, RunningQuery } from "../types.ts";
import { guarded } from "./errors.ts";
import { swallow } from "./reader.ts";

const pidRow = v.object({ pid: v.number() });
const runningRow = v.object({
  pid: v.number(),
  started: v.nullable(v.string()),
  query: v.string(),
  state: v.nullable(v.string()),
});

/** Process-wide registry of in-flight statements, so cancel can reach a backend from another connection. */
export type CancelChannel = {
  register(connectionId: string, queryId: string, pid: number): void;
  release(connectionId: string, queryId: string): void;
  pidOf(connectionId: string, queryId: string): number | null;
};

export function createCancelChannel(): CancelChannel {
  const pids = new Map<string, number>();
  const key = (connectionId: string, queryId: string): string => `${connectionId}:${queryId}`;
  return {
    register: (connectionId, queryId, pid) => void pids.set(key(connectionId, queryId), pid),
    release: (connectionId, queryId) => void pids.delete(key(connectionId, queryId)),
    pidOf: (connectionId, queryId) => pids.get(key(connectionId, queryId)) ?? null,
  };
}

/** Driver rows carry bigints (pool option `bigint: true`); they serialize as text. */
function replacer(_key: string, value: JsonValue | bigint): JsonValue {
  return v.safeParse(v.bigint(), value).success ? String(value) : v.parse(v.any(), value);
}

type Capped = { rows: string[]; truncated: boolean };

/** Row cap and byte budget, applied after the statement timeout did its part (12 §12.5). */
function applyCaps(all: string[], opts: QueryOptions): Capped {
  const rows: string[] = [];
  let bytes = 0;
  for (const row of all) {
    if (rows.length >= opts.rowCap || bytes + row.length > opts.byteBudget) break;
    rows.push(row);
    bytes += row.length;
  }
  return { rows, truncated: rows.length < all.length };
}

/**
 * User SQL on a reserved connection: read mode is a read-only transaction with a statement timeout;
 * results come back as row JSON with the caps applied (12 §12.5).
 */
export async function runQuery(
  sql: SQL,
  connectionId: string,
  cancel: CancelChannel,
  query: EngineQuery,
  opts: QueryOptions
): Promise<QueryResult> {
  const conn = await sql.reserve();
  const started = Date.now();
  const read = opts.mode === "read";
  try {
    const pid = v.parse(pidRow, (await conn.unsafe("SELECT pg_backend_pid() AS pid"))[0]).pid;
    cancel.register(connectionId, opts.queryId, pid);
    await conn.unsafe(read ? "BEGIN READ ONLY" : "BEGIN");
    await conn.unsafe(
      `SET LOCAL statement_timeout = ${Math.max(1, Math.floor(opts.timeBudgetMs))}`
    );
    await conn.unsafe("SET LOCAL TIME ZONE 'UTC'");
    const raw = await guarded("query", () => conn.unsafe(query.text));
    await conn.unsafe(read ? "ROLLBACK" : "COMMIT");
    const records = [...raw];
    const capped = applyCaps(
      records.map((row) => JSON.stringify(row, replacer)),
      opts
    );
    const first = records[0];
    return {
      columns:
        first === undefined ? [] : Object.keys(v.parse(v.record(v.string(), v.any()), first)),
      rows: capped.rows.map(rowText),
      rowsAffected: read ? null : (raw.count ?? null),
      truncated: capped.truncated,
      durationMs: Date.now() - started,
    };
  } catch (cause: unknown) {
    await swallow(conn.unsafe("ROLLBACK"));
    throw cause instanceof EngineError ? cause : new EngineError("batch_failed", String(cause));
  } finally {
    cancel.release(connectionId, opts.queryId);
    conn.release();
  }
}

export async function listRunningQueries(sql: SQL): Promise<RunningQuery[]> {
  const rows = await sql.unsafe(
    `SELECT pid, query_start::text AS started, query, state FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle' ORDER BY query_start`
  );
  return v.parse(v.array(runningRow), [...rows]).map((row) => ({
    pid: String(row.pid),
    startedAt: row.started ?? "",
    text: row.query,
    state: row.state ?? "",
  }));
}

/** `pg_cancel_backend` from a second connection (ADR 0001 cancel rule). */
export async function cancelQuery(
  sql: SQL,
  connectionId: string,
  cancel: CancelChannel,
  queryId: string
): Promise<void> {
  const pid = cancel.pidOf(connectionId, queryId);
  if (pid === null) return;
  await sql.unsafe("SELECT pg_cancel_backend($1)", [pid]);
}
