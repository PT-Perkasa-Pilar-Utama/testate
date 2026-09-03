import type { JsonObject, JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { plain } from "@/lib/plain-value.ts";
import { cellText } from "./grid.presenter.ts";

/** One field of a container as a person reads it. A container has no text; it opens a column. */
export type Entry = {
  key: string;
  text: string | null;
  kind: "value" | "object" | "array";
};

const container = v.record(v.string(), jsonValueSchema);

function valueText(value: JsonValue): string {
  return v.is(v.string(), value) ? JSON.stringify(value) : cellText(value);
}

/**
 * A typed wrapper (`{"$oid": ...}`, `{"$numberLong": ...}`, `{"$date": ...}`) reads bare, the
 * way its console shows it; a real string keeps its quotes, so "10" and 10 and a Long 10 differ.
 */
function entry(key: string, value: JsonValue): Entry {
  if (Array.isArray(value)) return { key, text: null, kind: "array" };
  if (v.is(container, value)) {
    const shown = plain(value);
    const unwrapped = !Array.isArray(shown) && !v.is(container, shown);
    return unwrapped
      ? { key, text: cellText(shown), kind: "value" }
      : { key, text: null, kind: "object" };
  }
  return { key, text: valueText(value), kind: "value" };
}

/** The fields of one container, one level deep, a nested object or array left for the next column. */
export function entriesOf(value: JsonValue): Entry[] {
  if (Array.isArray(value)) return value.map((item, index) => entry(String(index), item));
  if (!v.is(container, value)) return [];
  return Object.entries(value).map(([key, inner]) => entry(key, inner ?? null));
}

/** The container a path of keys leads to, or null when the path no longer fits the document. */
export function at(document: JsonObject, path: string[]): JsonValue | null {
  let current: JsonValue = document;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      const item: JsonValue | undefined = current[index];
      if (item === undefined) return null;
      current = item;
    } else if (v.is(container, current)) {
      const item: JsonValue | undefined = current[key];
      if (item === undefined) return null;
      current = item;
    } else return null;
  }
  return current;
}

/** The opened path, cut where it stops fitting the document it is now applied to. */
export function fitting(document: JsonObject, wanted: string[]): string[] {
  const kept: string[] = [];
  for (const key of wanted) {
    if (at(document, [...kept, key]) === null) break;
    kept.push(key);
  }
  return kept;
}

/** What a document is called in the list: its `_id`, plain. */
export function documentId(row: JsonObject): string {
  return cellText(row["_id"]);
}
