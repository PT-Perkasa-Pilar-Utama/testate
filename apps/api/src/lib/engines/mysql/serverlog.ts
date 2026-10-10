/**
 * MySQL and MariaDB server logs (#84; D1 of docs/decisions/2026-10-10-db-server-logs.md, with
 * its build notes). "Statements" is `performance_schema.events_statements_history_long`, a ring
 * buffer; "Error log" is MySQL's `performance_schema.error_log` (8.0.22+); "Slow log" is
 * `mysql.slow_log` when `log_output` includes TABLE. Each is found by trying it.
 */
import type { SQL } from "bun";
import type { LogLevel, ServerLogSource } from "@testate/shared";
import * as v from "valibot";

import { pageWindow } from "../../logs/server.ts";
import type { ServerLogEntry, ServerLogPage, ServerLogRead } from "../types.ts";

/** The most of any one table a page looks at: the history ring's default size. */
const WINDOW = 10000;

const uptimeRow = v.object({ Value: v.union([v.string(), v.number()]) });

/**
 * `TIMER_START` counts picoseconds from the server's start, so a statement's wall time is now
 * minus (uptime − TIMER_START). ponytail: `Uptime` is whole seconds, so times are within a second
 * of the clock; exact enough to order a page and to filter a window.
 */
async function serverStartMs(sql: SQL): Promise<number> {
  const rows = await sql.unsafe("SHOW GLOBAL STATUS LIKE 'Uptime'");
  return Date.now() - Number(v.parse(uptimeRow, rows[0]).Value) * 1000;
}

const statementRow = v.object({
  thread: v.union([v.number(), v.string()]),
  event: v.union([v.number(), v.string()]),
  timer: v.union([v.number(), v.string()]),
  text: v.nullable(v.string()),
  digest: v.nullable(v.string()),
  errno: v.nullable(v.union([v.number(), v.string()])),
  warnings: v.nullable(v.union([v.number(), v.string()])),
  message: v.nullable(v.string()),
  db: v.nullable(v.string()),
  examined: v.nullable(v.union([v.number(), v.string()])),
});

function statementLevel(errno: number, warnings: number): LogLevel {
  if (errno > 0) return "error";
  return warnings > 0 ? "warn" : "info";
}

/** A stable id for a row with none of its own, so follow never shows it twice. */
const idOf = (...parts: string[]): string =>
  Bun.hash(parts.join("\u0000")).toString(16).padStart(16, "0");

async function statements(sql: SQL): Promise<ServerLogEntry[]> {
  const start = await serverStartMs(sql);
  const rows = await sql.unsafe(
    `SELECT THREAD_ID AS thread, EVENT_ID AS event, TIMER_START AS timer, SQL_TEXT AS text,
            DIGEST_TEXT AS digest, MYSQL_ERRNO AS errno, WARNINGS AS warnings,
            MESSAGE_TEXT AS message, CURRENT_SCHEMA AS db, ROWS_EXAMINED AS examined
     FROM performance_schema.events_statements_history_long
     WHERE SQL_TEXT IS NOT NULL AND SQL_TEXT NOT LIKE '%events_statements_history_long%'
     ORDER BY TIMER_START DESC LIMIT ${WINDOW}`
  );
  return v.parse(v.array(statementRow), [...rows]).map((row) => {
    const errno = Number(row.errno ?? 0);
    const level = statementLevel(errno, Number(row.warnings ?? 0));
    return {
      key: {
        time: start + Number(row.timer) / 1e9,
        id: `${row.thread}:${String(row.event).padStart(12, "0")}`,
      },
      level,
      message: errno > 0 ? `${row.text ?? ""}\n${row.message ?? ""}` : (row.text ?? ""),
      digest: row.digest,
      fields: {
        thread: String(row.thread),
        db: row.db,
        rows_examined: Number(row.examined ?? 0),
        errno,
      },
    };
  });
}

const errorRow = v.object({
  logged: v.union([v.number(), v.string()]),
  prio: v.string(),
  code: v.nullable(v.string()),
  subsystem: v.nullable(v.string()),
  data: v.string(),
});
const PRIO = new Map<string, LogLevel>([
  ["System", "info"],
  ["Error", "error"],
  ["Warning", "warn"],
  ["Note", "info"],
]);

async function errorLog(sql: SQL): Promise<ServerLogEntry[]> {
  const rows = await sql.unsafe(
    `SELECT UNIX_TIMESTAMP(LOGGED) * 1000 AS logged, PRIO AS prio,
            ERROR_CODE AS code, SUBSYSTEM AS subsystem, DATA AS data
     FROM performance_schema.error_log ORDER BY LOGGED DESC LIMIT ${WINDOW}`
  );
  return v.parse(v.array(errorRow), [...rows]).map((row) => ({
    key: { time: Number(row.logged), id: idOf(String(row.logged), row.code ?? "", row.data) },
    level: PRIO.get(row.prio) ?? "info",
    message: row.data,
    digest: null,
    fields: { code: row.code, subsystem: row.subsystem },
  }));
}

const slowRow = v.object({
  started: v.union([v.number(), v.string()]),
  thread: v.union([v.number(), v.string()]),
  seconds: v.string(),
  db: v.nullable(v.string()),
  examined: v.union([v.number(), v.string()]),
  text: v.string(),
});

async function slowLog(sql: SQL): Promise<ServerLogEntry[]> {
  const rows = await sql.unsafe(
    `SELECT UNIX_TIMESTAMP(start_time) * 1000 AS started, thread_id AS thread,
            TIME_FORMAT(query_time, '%H:%i:%s.%f') AS seconds, db, rows_examined AS examined,
            CONVERT(sql_text USING utf8mb4) AS text
     FROM mysql.slow_log ORDER BY start_time DESC LIMIT ${WINDOW}`
  );
  return v.parse(v.array(slowRow), [...rows]).map((row) => ({
    key: { time: Number(row.started), id: idOf(String(row.started), String(row.thread), row.text) },
    level: "warn",
    message: row.text,
    digest: null,
    fields: {
      thread: String(row.thread),
      db: row.db,
      query_time: row.seconds,
      rows_examined: Number(row.examined),
    },
  }));
}

const READS = { statements, "error-log": errorLog, "slow-log": slowLog } as const;

export async function readServerLog(
  sql: SQL,
  source: ServerLogSource,
  page: ServerLogPage
): Promise<ServerLogRead> {
  const read = source === "server-log" ? null : READS[source];
  return pageWindow(read === null ? [] : await read(sql), page);
}

/** One cheap read per candidate; whatever answers is a source (D2). */
const PROBES: [ServerLogSource, string][] = [
  ["statements", "SELECT 1 FROM performance_schema.events_statements_history_long LIMIT 1"],
  ["error-log", "SELECT 1 FROM performance_schema.error_log LIMIT 1"],
  ["slow-log", "SELECT 1 FROM mysql.slow_log LIMIT 1"],
];

export async function serverLogSources(sql: SQL): Promise<ServerLogSource[]> {
  const found: ServerLogSource[] = [];
  for (const [source, statement] of PROBES) {
    try {
      await sql.unsafe(statement);
      if (source !== "slow-log" || (await slowLogOn(sql))) found.push(source);
    } catch {
      // Missing table, no grant, or performance_schema off: the screen shows the grant (D3).
    }
  }
  return found;
}

async function slowLogOn(sql: SQL): Promise<boolean> {
  const rows = await sql.unsafe("SELECT @@log_output AS output, @@slow_query_log AS slow");
  const row = v.parse(
    v.object({ output: v.string(), slow: v.union([v.number(), v.string()]) }),
    rows[0]
  );
  return row.output.includes("TABLE") && Number(row.slow) === 1;
}
