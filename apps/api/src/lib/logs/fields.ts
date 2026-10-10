/**
 * Reading a time and a level out of whatever a log line carries (docs/decisions/2026-10-10-logs-
 * tier.md, parser rules). Every reader of every format goes through these two.
 */
import type { JsonObject, JsonValue, LogLevel } from "@testate/shared";
import * as v from "valibot";

const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;
const positive = v.pipe(v.number(), v.finite(), v.minValue(1));

/** An ISO timestamp, with or without a zone; without one it is read as UTC. */
export function timeOfText(text: string): number | null {
  const trimmed = text.trim();
  if (!ISO.test(trimmed)) return null;
  const iso = trimmed.replace(" ", "T");
  const parsed = Date.parse(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Epoch milliseconds, or null. Numbers are epoch seconds below 1e11 and milliseconds above. */
export function timeOf(value: JsonValue | undefined): number | null {
  const number = v.safeParse(positive, value);
  if (number.success) return number.output < 1e11 ? number.output * 1000 : number.output;
  const text = v.safeParse(v.string(), value);
  return text.success ? timeOfText(text.output) : null;
}

const WORDS: [RegExp, LogLevel][] = [
  [/^(fatal|crit(ical)?|emerg(ency)?|alert|panic)$/, "fatal"],
  [/^(err(or)?|severe)$/, "error"],
  [/^warn(ing)?$/, "warn"],
  [/^(info|notice|information)$/, "info"],
  [/^debug$/, "debug"],
  [/^(trace|verbose|silly)$/, "trace"],
];

/** pino and bunyan number their levels: 10 trace up to 60 fatal. */
function numberedLevel(level: number): LogLevel {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  return level >= 20 ? "debug" : "trace";
}

/** A level from a word. */
export function levelOfText(text: string): LogLevel | null {
  const word = text.trim().toLowerCase();
  return WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

/** A level from a word or a pino number, or null when the value names none. */
export function levelOf(value: JsonValue | undefined): LogLevel | null {
  const number = v.safeParse(v.number(), value);
  if (number.success) return numberedLevel(number.output);
  const text = v.safeParse(v.string(), value);
  return text.success ? levelOfText(text.output) : null;
}

/** With no level of its own, a line from an error log is an error; anything else is info. */
export function fallbackLevel(file: string): LogLevel {
  return /(^|[-_.])(err|error|stderr)([-_.]|$)/i.test(file) ? "error" : "info";
}

/** The first of these keys present in an object, as JSON log libraries spell them. */
export function firstOf(object: JsonObject, keys: readonly string[]): JsonValue | undefined {
  const key = keys.find((candidate) => candidate in object);
  return key === undefined ? undefined : object[key];
}

/** A value as message text: a string as it is, anything else as JSON. */
export function asText(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  const text = v.safeParse(v.string(), value);
  return text.success ? text.output : JSON.stringify(value);
}
