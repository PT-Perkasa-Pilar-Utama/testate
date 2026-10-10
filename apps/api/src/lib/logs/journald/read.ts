/**
 * One page of a journal source (#86; J4 of docs/decisions/2026-10-10-journald.md), on journald's
 * own `__CURSOR`: the first page is the last N lines, an older page reads back from the oldest one
 * shown, and follow reads what came after the newest one shown.
 */
import type { JournalSource, LogsQuery } from "@testate/shared";
import { LOG_LINE_MAX } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../http/index.ts";
import { READ_CEILING } from "../read.ts";
import { journalCommand } from "./command.ts";
import type { JournalCommand } from "./command.ts";
import { journalEntryOf } from "./parse.ts";
import type { JournalEntry } from "./parse.ts";

export type ShellResult = { stdout: string; stderr: string; code: number | null; capped: boolean };

/** A command channel to the host: one command at a time, its output cut at `capBytes`. */
export type Shell = {
  run(command: string, capBytes: number): Promise<ShellResult>;
  close(): Promise<void>;
};

export type JournalRead = {
  /** Newest first. */
  entries: JournalEntry[];
  cursor: string | null;
  after: string;
  cutBy: "lines" | "bytes" | null;
  bytes: number;
};

const tokenSchema = v.object({ older: v.optional(v.string()), newer: v.nullable(v.string()) });

const encode = (token: v.InferOutput<typeof tokenSchema>): string =>
  Buffer.from(JSON.stringify(token)).toString("base64url");

function decode(raw: string): v.InferOutput<typeof tokenSchema> {
  try {
    return v.parse(tokenSchema, JSON.parse(Buffer.from(raw, "base64url").toString()));
  } catch {
    throw new AppError("VALIDATION_ERROR", "that cursor was not given out by this server");
  }
}

/** The command for a page; the window and level go to journalctl, the text filter stays here. */
function commandOf(source: JournalSource, query: LogsQuery): JournalCommand {
  const base = {
    units: source.units,
    since: query.from === undefined ? undefined : Date.parse(query.from),
    until: query.to === undefined ? undefined : Date.parse(query.to),
    level: query.level,
  };
  if (query.after !== undefined) {
    const newer = decode(query.after).newer;
    if (newer !== null)
      return { ...base, lines: LOG_LINE_MAX, cursor: { mode: "after", value: newer } };
  }
  if (query.cursor !== undefined) {
    const older = decode(query.cursor).older;
    if (older !== undefined)
      return {
        ...base,
        lines: query.limit + 1,
        cursor: { mode: "at", value: older },
        reverse: true,
      };
  }
  return { ...base, lines: query.limit };
}

function cutOf(full: boolean, capped: boolean): JournalRead["cutBy"] {
  if (full) return "lines";
  return capped ? "bytes" : null;
}

const matches = (entry: JournalEntry, text: string): boolean =>
  text === "" || `${entry.message} ${JSON.stringify(entry.fields)}`.toLowerCase().includes(text);

/** The page's lines, newest first: a reverse read is already, and starts with its cursor's line. */
function newestFirstOf(result: ShellResult, command: JournalCommand): JournalEntry[] {
  const lines = result.stdout.split("\n");
  // A cut output ends mid-line; that last line is not an entry yet.
  const whole = result.capped ? lines.slice(0, -1) : lines;
  const parsed = whole.flatMap((line) => journalEntryOf(line) ?? []);
  if (command.reverse !== true) return parsed.reverse();
  const at = command.cursor?.value;
  return parsed.filter((entry) => entry.cursor !== at);
}

/** Follow keeps its mark when nothing new came; every other read marks its newest line. */
function newestMark(page: JournalEntry[], command: JournalCommand): string | null {
  const first = page[0];
  if (first !== undefined) return first.cursor;
  return command.cursor?.mode === "after" ? command.cursor.value : null;
}

export async function readJournal(
  shell: Shell,
  source: JournalSource,
  query: LogsQuery
): Promise<JournalRead> {
  const command = commandOf(source, query);
  const result = await shell.run(journalCommand(command), READ_CEILING);
  if (result.code !== null && result.code !== 0)
    throw new AppError("ADAPTER_UNREACHABLE", result.stderr.trim() || "journalctl failed", {
      code: result.code,
    });
  const page = newestFirstOf(result, command).slice(0, query.limit);
  const full = command.cursor?.mode !== "after" && page.length === query.limit;
  const oldest = page.at(-1);
  const text = (query.text ?? "").toLowerCase();
  return {
    entries: page.filter((entry) => matches(entry, text)),
    cursor: full && oldest !== undefined ? encode({ older: oldest.cursor, newer: null }) : null,
    after: encode({ newer: newestMark(page, command) }),
    cutBy: cutOf(full, result.capped),
    bytes: Buffer.byteLength(result.stdout),
  };
}
