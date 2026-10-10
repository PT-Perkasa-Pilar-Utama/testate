/**
 * Reading one source: the files its glob matches, newest first, each from its end, merged by time,
 * filtered, cut at the line limit (Q6, S2 in docs/decisions/2026-10-10-logs-tier.md). It works over
 * any `LogFiles`, so SFTP, S3 and a test's memory are read the same way.
 *
 * `readSource` (source.ts) does the reading; this holds the pieces it is made of.
 *
 * Files are read in order of their modified time, newest first, and reading stops once the page is
 * full and the next file cannot hold anything newer than the oldest line kept: a file's modified
 * time is the newest any of its lines can be. So a hundred rotated files cost one or two reads.
 */
import type { LogLevel, LogsQuery } from "@testate/shared";
import { LOG_LEVELS } from "@testate/shared";

import type { Chunk, RawEntry } from "./chunk.ts";
import type { FileMark, FileMarks } from "./cursor.ts";

export type LogFile = { name: string; path: string; size: number; modified: number | null };
export type LogFiles = {
  /** The files directly in `dir`, relative to the connection's root. */
  list(dir: string): Promise<LogFile[]>;
  readRange(path: string, start: number, end: number): Promise<Uint8Array>;
};

/** At most this much is read per request (Q6). */
export const READ_CEILING = 10 * 1024 * 1024;

export type CutBy = "lines" | "bytes" | "window";
export type SourceRead = {
  entries: RawEntry[];
  cursor: string | null;
  after: string;
  cutBy: CutBy | null;
  untimed: boolean;
  filesOpened: number;
  bytesRead: number;
};

export type Glob = { dir: string; matches: (name: string) => boolean };

/** `logs/api-*.log` into its directory and a matcher on the file name (one directory, S1). */
export function splitGlob(glob: string): Glob {
  const slash = glob.lastIndexOf("/");
  const pattern = glob.slice(slash + 1).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const compiled = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return { dir: slash === -1 ? "" : glob.slice(0, slash), matches: (name) => compiled.test(name) };
}

const rank = (level: LogLevel): number => LOG_LEVELS.indexOf(level);

function matchesText(entry: RawEntry, text: string): boolean {
  if (text === "") return true;
  const fields = entry.fields === null ? "" : JSON.stringify(entry.fields);
  return `${entry.message} ${fields}`.toLowerCase().includes(text.toLowerCase());
}

function inWindow(entry: RawEntry, query: LogsQuery): boolean {
  if (query.from !== undefined && entry.time < Date.parse(query.from)) return false;
  return query.to === undefined || entry.time <= Date.parse(query.to);
}

/** That level and above, the text anywhere in the message or fields, and the window. */
export function passes(entry: RawEntry, query: LogsQuery, untimed: boolean): boolean {
  if (query.level !== undefined && rank(entry.level) < rank(query.level)) return false;
  if (!matchesText(entry, query.text ?? "")) return false;
  return untimed || inWindow(entry, query);
}

/** Newest first; ties (an untimed file's lines share a time) broken by position, later first. */
export const newestFirst = (a: RawEntry, b: RawEntry): number =>
  b.time - a.time || a.file.localeCompare(b.file) || b.offset - a.offset;

type Read = { file: LogFile; start: number; end: number; chunk: Chunk };
type Plan = { forward: boolean; marks: FileMarks | null; share: number; from: number | null };

export type Span = { start: number; end: number };

/** Forward: from the "after" mark to the end, or from 0 when the file is new or was rotated. */
function forwardSpan(file: LogFile, mark: FileMark | undefined, share: number): Span | null {
  const from = mark === undefined || file.size < mark.after ? 0 : mark.after;
  return from >= file.size ? null : { start: from, end: Math.min(file.size, from + share) };
}

/** Back: up to the "older" mark (the end on a first page), skipping files the window rules out. */
function backwardSpan(file: LogFile, mark: FileMark | undefined, plan: Plan): Span | null {
  // A file that appeared after the first page joins through "after", never through "older".
  if (plan.marks !== null && mark === undefined) return null;
  if (plan.from !== null && file.modified !== null && file.modified < plan.from) return null;
  const end = mark === undefined ? file.size : mark.before;
  return end <= 0 ? null : { start: Math.max(0, end - plan.share), end };
}

/** The byte range to read from one file, or null when it has nothing for this request. */
export function spanOf(file: LogFile, plan: Plan): Span | null {
  const mark = plan.marks?.get(file.path);
  return plan.forward ? forwardSpan(file, mark, plan.share) : backwardSpan(file, mark, plan);
}

export type { Plan, Read };
