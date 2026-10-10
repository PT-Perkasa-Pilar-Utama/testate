/**
 * `readSource`: one page of one source (Q6, S2; docs/decisions/2026-10-10-logs-tier.md).
 *
 * The page is merged from the end of every file at once, each step taking the newest of the files'
 * last unread entries. Every file gives up a run from its end and never a line from its middle, so
 * a page ends where the next begins: an out-of-order line is neither skipped nor shown twice.
 * Lines above a read's first whole entry are left for the older page, which reads up to them.
 */
import type { LogSource, LogsQuery } from "@testate/shared";

import { chunkOf } from "./chunk.ts";
import type { RawEntry } from "./chunk.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import type { FileMark, FileMarks } from "./cursor.ts";
import { parserFor } from "./parse.ts";
import type { LineParser } from "./parse.ts";
import { READ_CEILING, newestFirst, passes, spanOf, splitGlob } from "./read.ts";
import type { CutBy, LogFile, LogFiles, Plan, Read, SourceRead, Span } from "./read.ts";

const byModified = (a: LogFile, b: LogFile): number => (b.modified ?? 0) - (a.modified ?? 0);

/** A first read back is this big; a read doubles while the page is not full (Q6's ceiling holds). */
const FIRST_READ = 256 * 1024;

function planOf(query: LogsQuery, files: number): Plan {
  const raw = query.after ?? query.cursor;
  return {
    forward: query.after !== undefined,
    marks: raw === undefined ? null : decodeCursor(raw),
    // Back: start small and grow while the page is not full. Forward: what was written since.
    share:
      query.after === undefined
        ? Math.min(FIRST_READ, Math.floor(READ_CEILING / Math.max(1, files)))
        : READ_CEILING,
    from: query.from === undefined ? null : Date.parse(query.from),
  };
}

type Merged = { entries: RawEntry[]; left: number[] };

/** The last unread entry of read `n`, or undefined when it has none left. */
const lastOf = (reads: Read[], left: number[], n: number): RawEntry | undefined =>
  reads[n]?.chunk.entries[(left[n] ?? 0) - 1];

/** Which read's last unread entry is the newest, or -1 when every read is used up. */
function newestEnd(reads: Read[], left: number[]): number {
  let pick = -1;
  for (let n = 0; n < reads.length; n += 1) {
    const candidate = lastOf(reads, left, n);
    const best = lastOf(reads, left, pick);
    if (candidate !== undefined && (best === undefined || newestFirst(candidate, best) < 0))
      pick = n;
  }
  return pick;
}

/** The page; `left[n]` is how many of read n's entries it did not reach. */
function mergeFromEnds(reads: Read[], query: LogsQuery): Merged {
  const left = reads.map((read) => read.chunk.entries.length);
  const entries: RawEntry[] = [];
  while (entries.length < query.limit) {
    const pick = newestEnd(reads, left);
    const read = reads[pick];
    const entry = lastOf(reads, left, pick);
    if (read === undefined || entry === undefined) break;
    left[pick] = (left[pick] ?? 0) - 1;
    if (passes(entry, query, read.chunk.untimed)) entries.push(entry);
  }
  return { entries, left };
}

/** Once the page is full, a file last written before its oldest line has nothing to add. */
function canStop(reads: Read[], query: LogsQuery, file: LogFile): boolean {
  if (file.modified === null) return false;
  const { entries } = mergeFromEnds(reads, query);
  const oldest = entries.length >= query.limit ? entries.at(-1) : undefined;
  return oldest !== undefined && file.modified < oldest.time;
}

type Reading = { reads: Read[]; bytes: number; capped: boolean };

/**
 * One range of one file. It reads one byte early, so a line that starts exactly at `start` is
 * kept whole: the chunk drops everything up to the first newline it sees as a partial line.
 */
async function readOne(
  files: LogFiles,
  file: LogFile,
  start: number,
  end: number,
  parse: LineParser
): Promise<Read> {
  const from = start > 0 ? start - 1 : 0;
  const data = await files.readRange(file.path, from, end);
  return {
    file,
    start,
    end,
    chunk: chunkOf(data, from, file.name, parse, file.modified ?? Date.now()),
  };
}

/** Doubles every short read back that has more above it, within the ceiling; false when none can. */
async function grow(files: LogFiles, reading: Reading, parse: LineParser): Promise<boolean> {
  let grew = false;
  for (const [n, read] of reading.reads.entries()) {
    const room = READ_CEILING - reading.bytes;
    if (read.start === 0 || room <= 0) continue;
    const start = Math.max(
      0,
      read.end - Math.min(2 * (read.end - read.start), read.end - read.start + room)
    );
    reading.reads[n] = await readOne(files, read.file, start, read.end, parse);
    reading.bytes += read.end - start;
    grew = true;
  }
  return grew;
}

/** A span cut to the room left under the ceiling: back keeps its end, forward keeps its start. */
function within(span: Span, forward: boolean, room: number): Span {
  return forward
    ? { start: span.start, end: Math.min(span.end, span.start + room) }
    : { start: Math.max(span.start, span.end - room), end: span.end };
}

/** Reads the files newest first within the ceiling, and says whether the ceiling stopped it. */
async function readFiles(
  files: LogFiles,
  listed: LogFile[],
  plan: Plan,
  source: LogSource,
  query: LogsQuery
): Promise<Reading> {
  const parse = parserFor(source);
  const reading: Reading = { reads: [], bytes: 0, capped: false };
  for (const file of [...listed].sort(byModified)) {
    const room = READ_CEILING - reading.bytes;
    if (room <= 0) return { ...reading, capped: true };
    if (!plan.forward && canStop(reading.reads, query, file)) break;
    const span = spanOf(file, plan);
    if (span === null) continue;
    const { start, end } = within(span, plan.forward, room);
    reading.reads.push(await readOne(files, file, start, end, parse));
    reading.bytes += end - start;
  }
  while (!plan.forward && mergeFromEnds(reading.reads, query).entries.length < query.limit) {
    if (!(await grow(files, reading, parse))) break;
  }
  return { ...reading, capped: reading.bytes >= READ_CEILING };
}

/** Where "older" resumes in a file: at the oldest entry this page reached. */
function beforeOf(
  file: LogFile,
  read: Read | undefined,
  prior: FileMark | undefined,
  left: number
): number {
  if (read === undefined) return prior?.before ?? file.size;
  const entries = read.chunk.entries;
  if (entries.length === 0) return read.start;
  return left === entries.length ? read.end : (entries[left]?.offset ?? read.end);
}

function afterOf(
  file: LogFile,
  read: Read | undefined,
  prior: FileMark | undefined,
  forward: boolean
): number {
  if (forward) return read?.end ?? prior?.after ?? file.size;
  return prior?.after ?? file.size;
}

function marksOf(listed: LogFile[], reads: Read[], plan: Plan, left: number[]): FileMarks {
  const marks: FileMarks = new Map();
  for (const file of listed) {
    const prior = plan.marks?.get(file.path);
    const index = reads.findIndex((item) => item.file.path === file.path);
    const read = reads[index];
    const before = plan.forward
      ? (prior?.before ?? file.size)
      : beforeOf(file, read, prior, left[index] ?? 0);
    marks.set(file.path, { before, after: afterOf(file, read, prior, plan.forward) });
  }
  return marks;
}

/** Whether an entry the filters would pass was left for the next page. */
function moreLeft(reads: Read[], left: number[], query: LogsQuery): boolean {
  return reads.some((read, n) =>
    read.chunk.entries
      .slice(0, left[n] ?? 0)
      .some((entry) => passes(entry, query, read.chunk.untimed))
  );
}

/** Whether the window left out a file or an entry. */
function windowCut(reads: Read[], listed: LogFile[], from: number | null): boolean {
  if (from === null) return false;
  const early = (time: number | null): boolean => time !== null && time < from;
  return (
    listed.some((file) => early(file.modified)) ||
    reads.some(
      (read) => !read.chunk.untimed && read.chunk.entries.some((entry) => early(entry.time))
    )
  );
}

function cutByOf(
  more: boolean,
  reads: Read[],
  listed: LogFile[],
  plan: Plan,
  capped: boolean
): CutBy | null {
  if (more) return "lines";
  if (windowCut(reads, listed, plan.from)) return "window";
  const short = reads.some((read) => (plan.forward ? read.end < read.file.size : read.start > 0));
  return capped || short ? "bytes" : null;
}

export async function readSource(
  files: LogFiles,
  source: LogSource,
  query: LogsQuery
): Promise<SourceRead> {
  const { dir, matches } = splitGlob(source.glob);
  const listed = (await files.list(dir)).filter((file) => matches(file.name));
  const plan = planOf(query, listed.length);
  const { reads, bytes, capped } = await readFiles(files, listed, plan, source, query);
  const { entries, left } = mergeFromEnds(reads, query);
  const marks = marksOf(listed, reads, plan, left);
  return {
    entries,
    cursor: [...marks.values()].some((mark) => mark.before > 0) ? encodeCursor(marks) : null,
    after: encodeCursor(marks),
    cutBy: cutByOf(moreLeft(reads, left, query), reads, listed, plan, capped),
    untimed: reads.some((read) => read.chunk.untimed),
    filesOpened: reads.length,
    bytesRead: bytes,
  };
}
