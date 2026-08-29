import type { SQL } from "bun";
import type { JsonValue } from "@testate/shared";
import * as v from "valibot";

import { EngineError, rowText } from "../types.ts";
import type {
  EngineQuery,
  QueryOptions,
  QueryResult,
  RunningQuery,
  TerminateResult,
} from "../types.ts";
import type { CancelChannel } from "../postgres/query.ts";
import { guarded } from "./errors.ts";
import { swallow } from "./reader.ts";

const idRow = v.object({ id: v.union([v.number(), v.bigint(), v.string()]) });
const runningRow = v.object({
  id: v.union([v.number(), v.bigint(), v.string()]),
  time: v.nullable(v.union([v.number(), v.bigint()])),
  info: v.nullable(v.string()),
  state: v.nullable(v.string()),
});

export type Dialect = "mysql" | "mariadb";

/** `max_execution_time` is milliseconds on MySQL, `max_statement_time` seconds on MariaDB (ADR 0001). */
export function timeoutStatement(dialect: Dialect, budgetMs: number): string {
  return dialect === "mariadb"
    ? `SET SESSION max_statement_time = ${Math.max(0.001, budgetMs / 1000)}`
    : `SET SESSION max_execution_time = ${Math.max(1, Math.floor(budgetMs))}`;
}

function replacer(_key: string, value: JsonValue | bigint): JsonValue {
  return v.safeParse(v.bigint(), value).success ? String(value) : v.parse(v.any(), value);
}

type Capped = { rows: string[]; truncated: boolean };

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

/** Read mode runs `START TRANSACTION READ ONLY` with the dialect's statement timeout (12 §12.5). */
export async function runQuery(
  sql: SQL,
  dialect: Dialect,
  connectionId: string,
  cancel: CancelChannel,
  query: EngineQuery,
  opts: QueryOptions
): Promise<QueryResult> {
  const conn = await sql.reserve();
  const started = Date.now();
  const read = opts.mode === "read";
  try {
    const id = Number(v.parse(idRow, (await conn.unsafe("SELECT CONNECTION_ID() AS id"))[0]).id);
    cancel.register(connectionId, opts.queryId, id);
    await conn.unsafe(timeoutStatement(dialect, opts.timeBudgetMs));
    await conn.unsafe("SET SESSION time_zone = '+00:00'");
    await conn.unsafe(read ? "START TRANSACTION READ ONLY" : "START TRANSACTION");
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
      rowsAffected: read ? null : (raw.affectedRows ?? raw.count ?? null),
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
    `SELECT ID AS id, TIME AS time, INFO AS info, STATE AS state FROM information_schema.PROCESSLIST
     WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND COMMAND <> 'Sleep' ORDER BY TIME DESC`
  );
  return v.parse(v.array(runningRow), [...rows]).map((row) => ({
    pid: String(row.id),
    startedAt: new Date(Date.now() - Number(row.time ?? 0) * 1000).toISOString(),
    text: row.info ?? "",
    state: row.state ?? "",
  }));
}

/** `KILL CONNECTION <id>` ends the session that holds the lock (09 §9.5). */
export async function terminateSessions(sql: SQL, ids: string[]): Promise<TerminateResult> {
  const result: TerminateResult = { terminated: [], failed: [] };
  for (const id of ids) {
    const pid = Number.parseInt(id, 10);
    if (!Number.isInteger(pid)) {
      result.failed.push(id);
      continue;
    }
    try {
      await sql.unsafe(`KILL CONNECTION ${pid}`);
      result.terminated.push(id);
    } catch {
      result.failed.push(id);
    }
  }
  return result;
}

/** `KILL QUERY <id>` from a second connection interrupts the statement, not the session. */
export async function cancelQuery(
  sql: SQL,
  connectionId: string,
  cancel: CancelChannel,
  queryId: string
): Promise<void> {
  const id = cancel.pidOf(connectionId, queryId);
  if (id === null) return;
  await sql.unsafe(`KILL QUERY ${Math.floor(id)}`);
}
