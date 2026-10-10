/**
 * One `journalctl -o json` line as an entry (#86; J6 of docs/decisions/2026-10-10-journald.md).
 * Four fields say where a line came from; every other one is dropped, since `_CMDLINE` and its
 * kind can carry a secret.
 */
import type { JsonObject, LogLevel } from "@testate/shared";
import * as v from "valibot";

/** journald's `PRIORITY`, syslog's 0 (emerg) to 7 (debug). */
const LEVELS: LogLevel[] = ["fatal", "fatal", "fatal", "error", "warn", "info", "info", "debug"];

/** A journal field is text, or an array of bytes when it was not valid UTF-8. */
const fieldValue = v.union([v.string(), v.array(v.number())]);

const lineSchema = v.looseObject({
  __CURSOR: v.string(),
  __REALTIME_TIMESTAMP: v.string(),
  PRIORITY: v.optional(v.string()),
  MESSAGE: v.optional(v.nullable(fieldValue)),
  _SYSTEMD_UNIT: v.optional(fieldValue),
  SYSLOG_IDENTIFIER: v.optional(fieldValue),
  _PID: v.optional(fieldValue),
  _HOSTNAME: v.optional(fieldValue),
});

export type JournalEntry = {
  cursor: string;
  time: number;
  level: LogLevel;
  message: string;
  fields: JsonObject;
};

const decoder = new TextDecoder("utf-8", { fatal: true });

function textOf(value: v.InferOutput<typeof fieldValue> | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return value;
  try {
    return decoder.decode(Uint8Array.from(value));
  } catch {
    return "<binary>";
  }
}

/** The entry, or null for a line that is not a journal entry (a warning journalctl printed). */
export function journalEntryOf(line: string): JournalEntry | null {
  let parsed: v.SafeParseResult<typeof lineSchema>;
  try {
    parsed = v.safeParse(lineSchema, JSON.parse(line));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const entry = parsed.output;
  const priority = Number(entry.PRIORITY ?? 6);
  return {
    cursor: entry.__CURSOR,
    time: Math.floor(Number(entry.__REALTIME_TIMESTAMP) / 1000),
    level: LEVELS[priority] ?? "info",
    message: textOf(entry.MESSAGE) ?? "",
    fields: {
      unit: textOf(entry._SYSTEMD_UNIT),
      identifier: textOf(entry.SYSLOG_IDENTIFIER),
      pid: textOf(entry._PID),
      host: textOf(entry._HOSTNAME),
    },
  };
}
