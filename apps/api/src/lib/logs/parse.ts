/**
 * One line of a log file into a time, a level, a message and fields, per format (S1, parser
 * rules in docs/decisions/2026-10-10-logs-tier.md). A line that does not fit its format is read as
 * plain text rather than dropped: a logging bug must not hide the lines around it.
 */
import { jsonObjectSchema } from "@testate/shared";
import type { JsonObject, LogLevel, LogSource } from "@testate/shared";
import * as v from "valibot";

import { asText, firstOf, levelOf, levelOfText, timeOf, timeOfText } from "./fields.ts";
import { syslog } from "./parse.syslog.ts";

export type ParsedLine = {
  /** Epoch milliseconds, or null for a line with no time of its own (a stack trace's next line). */
  time: number | null;
  level: LogLevel | null;
  message: string;
  fields: JsonObject | null;
};
export type LineParser = (line: string) => ParsedLine;

/** No pattern ever sees more than this of a line (the regex screen's second half). */
export const LINE_CAP = 16 * 1024;

const PREFIX =
  /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?(?:\s*[:|-]?\s+|$)([\s\S]*)$/;
const LEADING_LEVEL = /^\[?([A-Za-z]{3,8})\]?[:\s]+([\s\S]*)$/;

/** A leading level word ("ERROR: ...", "[warn] ...") when there is one. */
function splitLevel(rest: string): { level: LogLevel | null; message: string } {
  const match = LEADING_LEVEL.exec(rest);
  const level = match?.[1] === undefined ? null : levelOfText(match[1]);
  return level === null || match?.[2] === undefined
    ? { level: null, message: rest }
    : { level, message: match[2] };
}

/** Plain text: a leading ISO timestamp and a level word when present, the rest as the message. */
export function plain(line: string): ParsedLine {
  const match = PREFIX.exec(line);
  const time = match?.[1] === undefined ? null : timeOfText(match[1].replace(",", "."));
  const rest = time === null ? line : (match?.[2] ?? "");
  return { time, fields: null, ...splitLevel(rest) };
}

function objectOf(line: string): JsonObject | null {
  if (!line.startsWith("{")) return null;
  try {
    const parsed = v.safeParse(jsonObjectSchema, JSON.parse(line));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

/** Everything but the keys a reader already shows, or null when nothing is left. */
function rest(object: JsonObject, shown: readonly string[]): JsonObject | null {
  const left = Object.entries(object).filter(([key]) => !shown.includes(key));
  return left.length === 0 ? null : Object.fromEntries(left);
}

const TIME_KEYS = ["time", "timestamp", "ts", "@timestamp", "date"] as const;
const LEVEL_KEYS = ["level", "severity", "lvl"] as const;
const MESSAGE_KEYS = ["msg", "message", "text", "event"] as const;
const nested = v.object({ level: v.optional(v.union([v.string(), v.number()])) });

/** JSON lines, as pino, bunyan, winston and most structured loggers write them. */
export function jsonLines(line: string): ParsedLine {
  const object = objectOf(line);
  if (object === null) return plain(line);
  const log = v.safeParse(nested, object["log"]);
  const level = levelOf(
    firstOf(object, LEVEL_KEYS) ?? (log.success ? log.output.level : undefined)
  );
  return {
    time: timeOf(firstOf(object, TIME_KEYS)),
    level,
    message: asText(firstOf(object, MESSAGE_KEYS)),
    fields: rest(object, [...TIME_KEYS, ...LEVEL_KEYS, ...MESSAGE_KEYS]),
  };
}

const wide = v.object({
  kind: v.optional(v.string()),
  request: v.optional(
    v.object({
      method: v.optional(v.string()),
      path: v.optional(v.string()),
      status: v.optional(v.number()),
    })
  ),
  job: v.optional(v.object({ kind: v.optional(v.string()), status: v.optional(v.string()) })),
  error: v.optional(v.object({ message: v.optional(v.string()) })),
});

/** A request as "GET /path 204", a job as "job snapshot succeeded", else the event's kind. */
function summary(event: v.InferOutput<typeof wide>): string {
  const { request, job } = event;
  const words = (parts: (string | number | undefined)[]): string =>
    parts.filter((part) => part !== undefined).join(" ");
  if (request !== undefined) return words([request.method, request.path, request.status]);
  if (job !== undefined) return words(["job", job.kind, job.status]);
  return event.kind ?? "event";
}

/** Testate's own wide events (spec 21): one line says what the request or job was and how it ended. */
export function testate(line: string): ParsedLine {
  const object = objectOf(line);
  const event = v.safeParse(wide, object);
  if (object === null || !event.success) return plain(line);
  const { error } = event.output;
  const what = summary(event.output);
  return {
    time: timeOf(object["ts"]),
    level: levelOf(object["level"]),
    message: error?.message === undefined ? what : `${what}: ${error.message}`,
    fields: rest(object, ["ts", "level"]),
  };
}

const pm2Json = v.object({
  message: v.string(),
  timestamp: v.optional(v.string()),
  type: v.optional(v.string()),
});

/** pm2: `--log-type json` lines, else the `--time` prefix, else plain text with no time. */
export function pm2(line: string): ParsedLine {
  const json = v.safeParse(pm2Json, objectOf(line));
  if (!json.success) return plain(line);
  return {
    time: json.output.timestamp === undefined ? null : timeOfText(json.output.timestamp),
    level: json.output.type === "err" ? "error" : null,
    message: json.output.message.replace(/\n$/, ""),
    fields: null,
  };
}

/** The `regex` format: named groups `time`, `level` and `message`; every other group a field. */
export function regexParser(pattern: string): LineParser {
  const compiled = new RegExp(pattern);
  return (line) => {
    const groups = compiled.exec(line)?.groups;
    if (groups === undefined) return plain(line);
    const { time, level, message, ...others } = groups;
    const fields = Object.fromEntries(
      Object.entries(others).filter(([, value]) => value !== undefined)
    );
    return {
      time: time === undefined ? null : timeOfText(time),
      level: level === undefined ? null : levelOfText(level),
      message: message ?? line,
      fields: Object.keys(fields).length === 0 ? null : fields,
    };
  };
}

const PARSERS = { pm2, "json-lines": jsonLines, testate, syslog, plain } as const;

/** The parser a source reads with; every line is cut at LINE_CAP before it sees it. */
export function parserFor(source: Pick<LogSource, "format" | "regex">): LineParser {
  const parse =
    source.format === "regex"
      ? regexParser(source.regex ?? "(?<message>.*)")
      : PARSERS[source.format];
  return (line) => parse(line.length > LINE_CAP ? line.slice(0, LINE_CAP) : line);
}
