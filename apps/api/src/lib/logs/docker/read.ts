/**
 * One page of a container's log (#88; K5 of docs/decisions/2026-10-10-docker.md), by position. The
 * Engine API takes `tail` before `since` and `until`, and a container's stamps can step back, so a
 * page never trusts a time to find its place: it finds the line itself, by its stamp, stream and
 * text, in a tail grown until that line and the page before it fit.
 */
import { createHash } from "node:crypto";
import { LOG_LINE_MAX, LOG_WINDOW_MAX_MS } from "@testate/shared";
import type { LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../http/index.ts";
import { READ_CEILING } from "../read.ts";
import type { DockerApi } from "./api.ts";
import { dockerLines, nanosOf } from "./frames.ts";
import type { DockerLine } from "./frames.ts";

export type ContainerRead = {
  /** Newest first. */
  lines: DockerLine[];
  cursor: string | null;
  after: string;
  cutBy: "lines" | "bytes" | null;
  bytes: number;
};

/** Where follow looks back from the newest line shown, for a stamp that stepped back. */
const FOLLOW_SLACK_NS = 5_000_000_000n;
/** Lines that may arrive between two reads of an older page. */
const ARRIVALS = 64;

const markSchema = v.object({
  stamp: v.string(),
  stream: v.nullable(v.picklist(["stdout", "stderr"])),
  hash: v.string(),
});
type Mark = v.InferOutput<typeof markSchema>;
const tokenSchema = v.object({
  older: v.optional(v.object({ mark: markSchema, depth: v.number() })),
  newer: v.nullable(markSchema),
});
type Token = v.InferOutput<typeof tokenSchema>;

const encode = (token: Token): string => Buffer.from(JSON.stringify(token)).toString("base64url");

function decode(raw: string): Token {
  try {
    return v.parse(tokenSchema, JSON.parse(Buffer.from(raw, "base64url").toString()));
  } catch {
    throw new AppError("VALIDATION_ERROR", "that cursor was not given out by this server");
  }
}

const hashOf = (text: string): string =>
  createHash("sha256").update(text).digest("base64url").slice(0, 16);

const markOf = (line: DockerLine): Mark => ({
  stamp: line.stamp,
  stream: line.stream,
  hash: hashOf(line.text),
});

const isMark = (line: DockerLine, mark: Mark): boolean =>
  line.stamp === mark.stamp && line.stream === mark.stream && hashOf(line.text) === mark.hash;

const nanosOfIso = (iso: string | undefined): bigint | undefined =>
  iso === undefined ? undefined : BigInt(Date.parse(iso)) * 1_000_000n;

type Got = { lines: DockerLine[]; capped: boolean; bytes: number };
type Reader = (tail: number | "all", since?: bigint, until?: bigint) => Promise<Got>;

/** Reads a container's log with `timestamps=1`; a refusal says what Docker said. */
export function containerReader(api: DockerApi, container: string, tty: boolean): Reader {
  return async (tail, since, until) => {
    const answer = await api.get({ kind: "logs", container, tail, since, until }, READ_CEILING);
    if (answer.status !== 200)
      throw new AppError("ADAPTER_UNREACHABLE", `Docker answered ${answer.status}`, {
        status: answer.status,
      });
    return {
      lines: dockerLines(answer.body, tty, answer.capped),
      capped: answer.capped,
      bytes: answer.body.length,
    };
  };
}

type Before = { page: DockerLine[]; depth: number | null; cut: boolean };

/** The next tail: doubled, but never past what the byte ceiling holds at this read's line size. */
function grown(tail: number, got: Got): number {
  const average = got.bytes / Math.max(1, got.lines.length);
  return Math.min(tail * 2, Math.floor(READ_CEILING / Math.max(1, average)));
}

/**
 * The `limit` lines before the line `endOf` points at (oldest to newest), growing the tail until
 * they fit, the log starts, or the byte ceiling stops it. `depth` is how far from the end the page
 * starts, for the next older page; null at the start of the log.
 */
async function pageBefore(
  read: Reader,
  since: bigint | undefined,
  limit: number,
  firstTail: number,
  endOf: (lines: DockerLine[]) => number | null
): Promise<Before> {
  for (let tail = firstTail; ;) {
    const got = await read(tail, since);
    const end = endOf(got.lines);
    if (end !== null && end >= limit)
      return {
        page: got.lines.slice(end - limit, end),
        depth: got.lines.length - end + limit,
        cut: false,
      };
    const whole = end === null ? [] : got.lines.slice(0, end);
    if (!got.capped && got.lines.length < tail) return { page: whole, depth: null, cut: false };
    const next = grown(tail, got);
    if (got.capped || next <= tail) return { page: whole, depth: null, cut: true };
    tail = next;
  }
}

const endBefore =
  (mark: Mark) =>
  (lines: DockerLine[]): number | null => {
    const at = lines.findIndex((line) => isMark(line, mark));
    return at === -1 ? null : at;
  };

/** Lines after the newest one shown; when it is gone, those stamped after it. */
async function follow(read: Reader, mark: Mark): Promise<ContainerRead> {
  const markNanos = nanosOf(mark.stamp) ?? 0n;
  const since = markNanos - FOLLOW_SLACK_NS;
  const got = await read("all", since > 0n ? since : undefined);
  const at = got.lines.findIndex((line) => isMark(line, mark));
  const fresh =
    at === -1 ? got.lines.filter((line) => line.nanos > markNanos) : got.lines.slice(at + 1);
  const page = fresh.slice(0, LOG_LINE_MAX);
  const newest = page.at(-1);
  return {
    lines: page.reverse(),
    cursor: null,
    after: encode({ newer: newest === undefined ? mark : markOf(newest) }),
    cutBy: got.capped ? "bytes" : null,
    bytes: got.bytes,
  };
}

function cutOf(before: Before, older: string | null): ContainerRead["cutBy"] {
  if (before.cut) return "bytes";
  return older === null ? null : "lines";
}

function pageOf(
  before: Before,
  limit: number,
  bytes: number,
  previous: Mark | null
): ContainerRead {
  const oldest = before.page[0];
  const newest = before.page.at(-1);
  const older =
    before.depth !== null && oldest !== undefined && before.page.length === limit
      ? encode({ older: { mark: markOf(oldest), depth: before.depth }, newer: null })
      : null;
  return {
    lines: [...before.page].reverse(),
    cursor: older,
    after: encode({ newer: newest === undefined ? previous : markOf(newest) }),
    cutBy: cutOf(before, older),
    bytes,
  };
}

/**
 * A page in a window that ends at `to`: one read with no tail, `since` and `until` set, so the
 * window's own lines bound it and not what came after (Q8's run windows). Docker streams oldest
 * first, so a read cut at the ceiling lost the window's newest lines and says so.
 */
async function windowPage(
  read: Reader,
  query: LogsQuery,
  to: bigint,
  mark: Mark | null
): Promise<Before & { bytes: number }> {
  const since = nanosOfIso(query.from) ?? to - BigInt(LOG_WINDOW_MAX_MS) * 1_000_000n;
  const got = await read("all", since, to);
  const end = mark === null ? got.lines.length : endBefore(mark)(got.lines);
  const start = Math.max(0, (end ?? 0) - query.limit);
  const page = end === null ? [] : got.lines.slice(start, end);
  const depth = start > 0 && !got.capped ? 0 : null;
  return { page, depth, cut: got.capped, bytes: got.bytes };
}

export async function readContainer(read: Reader, query: LogsQuery): Promise<ContainerRead> {
  const since = nanosOfIso(query.from);
  if (query.after !== undefined) {
    const newer = decode(query.after).newer;
    if (newer !== null) return follow(read, newer);
  }
  const older = query.cursor === undefined ? undefined : decode(query.cursor).older;
  const to = nanosOfIso(query.to);
  if (to !== undefined) {
    const window = await windowPage(read, query, to, older?.mark ?? null);
    return pageOf(window, query.limit, window.bytes, null);
  }
  let bytes = 0;
  const counted: Reader = async (tail, from) => {
    const got = await read(tail, from);
    bytes += got.bytes;
    return got;
  };
  const before =
    older === undefined
      ? await pageBefore(counted, since, query.limit, query.limit, (lines) => lines.length)
      : await pageBefore(
          counted,
          since,
          query.limit,
          older.depth + query.limit + ARRIVALS,
          endBefore(older.mark)
        );
  return pageOf(before, query.limit, bytes, null);
}
