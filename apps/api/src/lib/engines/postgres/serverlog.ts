/**
 * PostgreSQL server logs (#84; D1 of docs/decisions/2026-10-10-db-server-logs.md, with its build
 * notes). "Statements" is each session's latest statement from `pg_stat_activity`, which any role
 * may read (other users' statements need `pg_read_all_stats`); `pg_stat_statements` holds totals,
 * not a time per run, so it is no log. "Server log" is the tail of the current log file.
 */
import type { SQL } from "bun";
import type { LogLevel, ServerLogSource } from "@testate/shared";
import * as v from "valibot";

import { pageWindow } from "../../logs/server.ts";
import type { ServerLogEntry, ServerLogPage, ServerLogRead } from "../types.ts";

/**
 * ponytail: the last 1 MB of the current log file only; older lines and rotated files need a
 * `logfile` adapter on the database host. Upgrade: list `pg_ls_logdir()` and page back by offset.
 */
const TAIL_BYTES = 1024 * 1024;

const activityRow = v.object({
  id: v.string(),
  time: v.number(),
  state: v.nullable(v.string()),
  query: v.string(),
  user: v.nullable(v.string()),
  application: v.nullable(v.string()),
  wait: v.nullable(v.string()),
});

async function statements(sql: SQL): Promise<ServerLogEntry[]> {
  const rows = await sql.unsafe(
    `SELECT pid::text AS id,
            (extract(epoch FROM COALESCE(query_start, state_change, backend_start)) * 1000)::float8 AS time,
            state, query, usename AS user, application_name AS application,
            CASE WHEN wait_event IS NULL THEN NULL ELSE wait_event_type || ':' || wait_event END AS wait
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid() AND COALESCE(query, '') <> ''`
  );
  return v.parse(v.array(activityRow), [...rows]).map((row) => ({
    key: { time: row.time, id: row.id.padStart(10, "0") },
    level: row.state === "idle in transaction (aborted)" ? "warn" : "info",
    message: row.query,
    digest: null,
    fields: {
      pid: row.id,
      state: row.state,
      user: row.user,
      application: row.application,
      wait: row.wait,
    },
  }));
}

const LEVEL_WORDS: [RegExp, LogLevel][] = [
  [/^(PANIC|FATAL)$/, "fatal"],
  [/^ERROR$/, "error"],
  [/^WARNING$/, "warn"],
  [/^DEBUG\d?$/, "debug"],
];
/** `2026-10-10 08:00:00.123 UTC [77] ERROR:  message`, the default `log_line_prefix`. */
const LINE =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)(?: (UTC|GMT|[+-]\d{2}(?::?\d{2})?))?\b.*?\b([A-Z]+\d?):\s+(.*)$/;

const levelOf = (word: string): LogLevel =>
  LEVEL_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? "info";

function timeOf(stamp: string, zone: string | undefined): number {
  const offset = zone === undefined || zone === "UTC" || zone === "GMT" ? "Z" : zone;
  return Date.parse(`${stamp.replace(" ", "T")}${offset}`);
}

/** Lines into entries: a line with no stamp (DETAIL, STATEMENT, a wrapped query) joins the one above. */
export function parseServerLog(text: string, startOffset: number): ServerLogEntry[] {
  const entries: ServerLogEntry[] = [];
  let offset = startOffset;
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    const last = entries.at(-1);
    if (match !== null && !Number.isNaN(timeOf(match[1] ?? "", match[2]))) {
      entries.push({
        key: { time: timeOf(match[1] ?? "", match[2]), id: String(offset).padStart(12, "0") },
        level: levelOf(match[3] ?? ""),
        message: match[4] ?? "",
        digest: null,
        fields: null,
      });
    } else if (last !== undefined && line.trim() !== "") {
      last.message = `${last.message}\n${line}`;
    }
    offset += Buffer.byteLength(line) + 1;
  }
  return entries;
}

const fileRow = v.object({ path: v.nullable(v.string()), size: v.nullable(v.number()) });

async function serverLog(sql: SQL): Promise<ServerLogEntry[]> {
  const file = v.parse(
    fileRow,
    (
      await sql.unsafe(
        `SELECT pg_current_logfile() AS path,
                (SELECT size FROM pg_stat_file(pg_current_logfile()))::float AS size`
      )
    )[0]
  );
  if (file.path === null || file.size === null) return [];
  const start = Math.max(0, file.size - TAIL_BYTES);
  const chunk = v.parse(
    v.object({ text: v.string() }),
    (
      await sql.unsafe("SELECT pg_read_file($1, $2, $3) AS text", [
        file.path,
        start,
        file.size - start,
      ])
    )[0]
  );
  // A tail that starts mid-line drops its first, partial line.
  const text = start === 0 ? chunk.text : chunk.text.slice(chunk.text.indexOf("\n") + 1);
  const skipped = start === 0 ? 0 : chunk.text.indexOf("\n") + 1;
  return parseServerLog(text, start + skipped);
}

export async function readServerLog(
  sql: SQL,
  source: ServerLogSource,
  page: ServerLogPage
): Promise<ServerLogRead> {
  if (source === "statements") return pageWindow(await statements(sql), page);
  return pageWindow(await serverLog(sql), page);
}

/** The sources this credential can read, each found by trying it (D2). */
export async function serverLogSources(sql: SQL): Promise<ServerLogSource[]> {
  const found: ServerLogSource[] = ["statements"];
  try {
    const rows = await sql.unsafe("SELECT pg_read_file(pg_current_logfile(), 0, 1) AS ok");
    if (v.parse(v.object({ ok: v.nullable(v.string()) }), rows[0]).ok !== null)
      found.push("server-log");
  } catch {
    // No `pg_read_server_files`, or the collector is off: the screen shows the grant (D3).
  }
  return found;
}
