/**
 * One read of one file into entries (S2, parser rules in docs/decisions/2026-10-10-logs-tier.md):
 * a line with no time of its own joins the entry above it, and a file with no times at all is read
 * line by line in file order. Offsets are bytes, so a cursor can resume exactly where a page ended.
 */
import type { JsonObject, LogLevel } from "@testate/shared";

import { fallbackLevel } from "./fields.ts";
import type { LineParser } from "./parse.ts";

export type RawEntry = {
  /** Epoch milliseconds; an untimed file's lines carry the file's modified time. */
  time: number;
  level: LogLevel;
  file: string;
  message: string;
  fields: JsonObject | null;
  /** Byte offset of the entry's first line in its file. */
  offset: number;
};

export type Chunk = {
  entries: RawEntry[];
  /**
   * Where the first whole entry starts. Lines above it continue an entry that began before this
   * read, so an "older" page must read up to here, not up to the read's start.
   */
  firstEntry: number;
  untimed: boolean;
};

const decoder = new TextDecoder();

type Line = { text: string; offset: number };

/** Lines with their byte offsets; a read that starts mid-file drops its partial first line. */
export function linesOf(bytes: Uint8Array, start: number): Line[] {
  const lines: Line[] = [];
  let from = 0;
  if (start > 0) {
    const first = bytes.indexOf(0x0a);
    if (first === -1) return lines;
    from = first + 1;
  }
  while (from < bytes.length) {
    const end = bytes.indexOf(0x0a, from);
    const stop = end === -1 ? bytes.length : end;
    const text = decoder.decode(bytes.subarray(from, stop)).replace(/\r$/, "");
    if (text.trim() !== "") lines.push({ text, offset: start + from });
    from = stop + 1;
  }
  return lines;
}

function untimedEntries(lines: Line[], parse: LineParser, file: string, modified: number): Chunk {
  const entries = lines.map((line): RawEntry => {
    const parsed = parse(line.text);
    return {
      time: modified,
      level: parsed.level ?? fallbackLevel(file),
      file,
      message: parsed.message,
      fields: parsed.fields,
      offset: line.offset,
    };
  });
  return { entries, firstEntry: lines[0]?.offset ?? Number.POSITIVE_INFINITY, untimed: true };
}

/** Entries of one read. `modified` stamps an untimed file's lines; `end` is where the read stopped. */
export function chunkOf(
  bytes: Uint8Array,
  start: number,
  file: string,
  parse: LineParser,
  modified: number
): Chunk {
  const lines = linesOf(bytes, start);
  const parsed = lines.map((line) => ({ line, parsed: parse(line.text) }));
  // A read with no timestamp in any line is an untimed file (pm2 without --time): it is read
  // line by line in file order, wherever the read starts.
  if (!parsed.some((item) => item.parsed.time !== null))
    return untimedEntries(lines, parse, file, modified);
  const entries: RawEntry[] = [];
  let firstEntry = Number.POSITIVE_INFINITY;
  for (const { line, parsed: one } of parsed) {
    const current = entries.at(-1);
    if (one.time === null) {
      // A continuation line: part of the entry above, or of one that began before this read.
      if (current !== undefined) current.message += `\n${line.text}`;
      continue;
    }
    if (entries.length === 0) firstEntry = line.offset;
    entries.push({
      time: one.time,
      level: one.level ?? fallbackLevel(file),
      file,
      message: one.message,
      fields: one.fields,
      offset: line.offset,
    });
  }
  return { entries, firstEntry, untimed: false };
}
