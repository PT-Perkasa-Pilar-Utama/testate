/**
 * One page of a Loki source (#90; L5 of docs/decisions/2026-10-10-loki.md), on Loki's own stamp.
 * `start` is inclusive and `end` exclusive, and lines sharing a nanosecond split across pages in no
 * stable order, so a mark is a stamp plus the lines already shown at it.
 */
import { LOG_LINE_MAX, LOG_WINDOW_MAX_MS } from "@testate/shared";
import type { LokiSource, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../http/index.ts";
import { READ_CEILING } from "../read.ts";
import type { LokiApi } from "./api.ts";
import { linesOf } from "./parse.ts";
import type { LokiLine } from "./parse.ts";

export type LokiRead = {
  /** Newest first. */
  lines: LokiLine[];
  cursor: string | null;
  after: string;
  cutBy: "lines" | "window" | null;
  bytes: number;
};

const NS_PER_MS = 1_000_000n;
const WINDOW_NS = BigInt(LOG_WINDOW_MAX_MS) * NS_PER_MS;

const markSchema = v.object({
  stamp: v.pipe(v.string(), v.regex(/^\d{1,20}$/)),
  seen: v.array(v.string()),
});
type Mark = v.InferOutput<typeof markSchema>;
const tokenSchema = v.object({ older: v.optional(markSchema), newer: v.nullable(markSchema) });
type Token = v.InferOutput<typeof tokenSchema>;

const encode = (token: Token): string => Buffer.from(JSON.stringify(token)).toString("base64url");

function decode(raw: string): Token {
  try {
    return v.parse(tokenSchema, JSON.parse(Buffer.from(raw, "base64url").toString()));
  } catch {
    throw new AppError("VALIDATION_ERROR", "that cursor was not given out by this server");
  }
}

const nanosOfIso = (iso: string | undefined): bigint | undefined =>
  iso === undefined ? undefined : BigInt(Date.parse(iso)) * NS_PER_MS;

/** Newest first, or oldest first; lines at one nanosecond keep Loki's order. */
const byTime =
  (newestFirst: boolean) =>
  (a: LokiLine, b: LokiLine): number => {
    if (a.nanos === b.nanos) return 0;
    return a.nanos < b.nanos === newestFirst ? 1 : -1;
  };

/** Drops the lines a mark says were shown already. */
function unseen(lines: LokiLine[], mark: Mark | undefined): LokiLine[] {
  if (mark === undefined) return lines;
  const at = BigInt(mark.stamp);
  const seen = new Set(mark.seen);
  return lines.filter((line) => line.nanos !== at || !seen.has(line.id));
}

/** A mark at `line`, carrying what was shown at its nanosecond before. */
function markAt(line: LokiLine, page: LokiLine[], previous: Mark | undefined): Mark {
  const here = page.filter((item) => item.nanos === line.nanos).map((item) => item.id);
  const before =
    previous !== undefined && BigInt(previous.stamp) === line.nanos ? previous.seen : [];
  return { stamp: String(line.nanos), seen: [...new Set([...before, ...here])] };
}

type Asked = {
  query: string;
  direction: "backward" | "forward";
  limit: number;
  start: bigint;
  end?: bigint;
};
type Got = { lines: LokiLine[]; bytes: number };

async function ask(api: LokiApi, asked: Asked): Promise<Got> {
  const answer = await api.get({ kind: "query", ...asked }, READ_CEILING);
  const lines = linesOf(answer).sort(byTime(asked.direction === "backward"));
  return { lines, bytes: answer.body.length };
}

/** Lines after the newest shown, oldest of them first from Loki, given back newest first. */
async function follow(api: LokiApi, source: LokiSource, mark: Mark): Promise<LokiRead> {
  const start = BigInt(mark.stamp);
  // Never past Loki's default `max_entries_limit_per_query`, which is the same 5 000.
  const limit = LOG_LINE_MAX;
  const got = await ask(api, { query: source.query, direction: "forward", limit, start });
  const page = unseen(got.lines, mark).slice(0, LOG_LINE_MAX);
  const newest = page.at(-1);
  return {
    lines: page.reverse(),
    cursor: null,
    after: encode({ newer: newest === undefined ? mark : markAt(newest, page, mark) }),
    cutBy: null,
    bytes: got.bytes,
  };
}

type Older = { cursor: string | null; cutBy: LokiRead["cutBy"] };

/**
 * Where the next older page starts. A full read leaves more in the range. A short read with no
 * `from` ends a 7-day range, not the log: the next page searches the 7 days before it, until a
 * whole range is empty.
 */
function olderOf(
  full: boolean,
  page: LokiLine[],
  mark: Mark | undefined,
  start: bigint,
  from: bigint | undefined
): Older {
  const oldest = page.at(-1);
  // ponytail: more lines at one nanosecond than a page holds stall here. A page of that stamp alone
  // (an `end` and `start` one nanosecond apart, growing `limit`) is the upgrade.
  if (full && oldest === undefined) return { cursor: null, cutBy: "lines" };
  if (full && oldest !== undefined)
    return { cursor: encode({ older: markAt(oldest, page, mark), newer: null }), cutBy: "lines" };
  if (from !== undefined) return { cursor: null, cutBy: null };
  if (oldest === undefined) return { cursor: null, cutBy: "window" };
  return {
    cursor: encode({ older: { stamp: String(start - 1n), seen: [] }, newer: null }),
    cutBy: null,
  };
}

export async function readLoki(
  api: LokiApi,
  source: LokiSource,
  query: LogsQuery,
  now: () => number
): Promise<LokiRead> {
  const after = query.after === undefined ? null : decode(query.after).newer;
  if (after !== null) return follow(api, source, after);
  const mark = query.cursor === undefined ? undefined : decode(query.cursor).older;
  const to = nanosOfIso(query.to);
  // Testate's `to` is inclusive, Loki's `end` is not.
  const end =
    mark !== undefined ? BigInt(mark.stamp) + 1n : (to ?? BigInt(now()) * NS_PER_MS) + NS_PER_MS;
  const from = nanosOfIso(query.from);
  const start = from ?? end - WINDOW_NS;
  const limit = Math.min(query.limit + (mark?.seen.length ?? 0), LOG_LINE_MAX);
  const got = await ask(api, { query: source.query, direction: "backward", limit, start, end });
  const page = unseen(got.lines, mark).slice(0, query.limit);
  const newest = page[0];
  return {
    lines: page,
    ...olderOf(got.lines.length === limit, page, mark, start, from),
    after: encode({ newer: newest === undefined ? null : markAt(newest, page, undefined) }),
    bytes: got.bytes,
  };
}
