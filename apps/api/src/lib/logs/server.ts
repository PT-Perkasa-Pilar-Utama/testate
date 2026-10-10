/**
 * What every database's server-log read shares (#84; D4, D7 of
 * docs/decisions/2026-10-10-db-server-logs.md): the key a page is ordered by, its opaque cursor,
 * and how a statement is shown to a reader who is masked.
 */
import { jsonObjectSchema } from "@testate/shared";
import type { JsonValue } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../http/index.ts";

/** A source entry's place: newest first by time, ties broken by an id the engine keeps stable. */
export type ServerKey = { time: number; id: string };

const keySchema = v.object({ time: v.number(), id: v.string() });
const cursorSchema = v.object({ before: v.nullable(keySchema), after: v.nullable(keySchema) });
export type ServerCursor = v.InferOutput<typeof cursorSchema>;

/** Whether `a` sorts after `b`: newer, or the same time and a later id. */
export const isNewer = (a: ServerKey, b: ServerKey): boolean =>
  a.time > b.time || (a.time === b.time && a.id > b.id);

export function encodeServerCursor(cursor: ServerCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** A cursor this server gave out, or `VALIDATION_ERROR` (25 §25.4). */
export function decodeServerCursor(raw: string): ServerCursor {
  try {
    return v.parse(cursorSchema, JSON.parse(Buffer.from(raw, "base64url").toString()));
  } catch {
    throw new AppError("VALIDATION_ERROR", "that cursor was not given out by this server");
  }
}

/**
 * A statement with its values taken out: quoted strings and numbers become `?`; placeholders
 * (`$1`, `?`) and identifiers stay. What a viewer reads when the engine keeps no digest (D7).
 */
export function maskLiterals(statement: string): string {
  return statement
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "?")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, "?")
    .replace(/(?<![\w$.])-?\d+(?:\.\d+)?(?![\w.])/g, "?");
}

/** A MongoDB command with its values taken out: its keys stay, every value becomes `"?"` (D7). */
export function withoutValues(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withoutValues);
  const object = v.safeParse(jsonObjectSchema, value);
  if (!object.success) return "?";
  return Object.fromEntries(
    Object.entries(object.output).map(([key, inner]) => [key, withoutValues(inner)])
  );
}

/** A page of a window: newest first; `end` when nothing older is left in it. */
export type WindowPage<T> = { entries: T[]; end: boolean };

/** The fields every page step needs from an entry; the engine port's entry has these and more. */
type Keyed = { key: ServerKey };

/**
 * One page of a source's bounded window (a snapshot, a ring buffer, a log's tail): newest first,
 * entries strictly before `before` or strictly after `after`, at most `limit`. `end` says nothing
 * older is left in the window.
 */
export function pageWindow<T extends Keyed>(
  window: readonly T[],
  page: { limit: number; before: ServerKey | null; after: ServerKey | null }
): WindowPage<T> {
  const { before, after } = page;
  const kept = window
    .filter((entry) => before === null || isNewer(before, entry.key))
    .filter((entry) => after === null || isNewer(entry.key, after))
    .sort((a, b) => (isNewer(a.key, b.key) ? -1 : 1));
  return { entries: kept.slice(0, page.limit), end: kept.length <= page.limit };
}
