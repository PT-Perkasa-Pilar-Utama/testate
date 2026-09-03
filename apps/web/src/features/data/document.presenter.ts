import type { JsonObject, JsonValue } from "@testate/shared";
import * as v from "valibot";

import { plain } from "@/lib/plain-value.ts";
import { cellText } from "./grid.presenter.ts";

/** One line of a document as a person reads it: a key, its value, and how deep it sits. */
export type FieldLine = {
  key: string;
  depth: number;
  /** The value as text; a container has none, its children follow it. */
  text: string | null;
  kind: "value" | "object" | "array";
};

const objectSchema = v.record(v.string(), v.unknown());

function valueText(value: JsonValue): string {
  if (v.is(v.string(), value)) return JSON.stringify(value);
  return cellText(value);
}

function push(lines: FieldLine[], key: string, value: JsonValue, depth: number): void {
  if (Array.isArray(value)) {
    lines.push({ key, depth, text: null, kind: "array" });
    value.forEach((item, index) => push(lines, String(index), item, depth + 1));
    return;
  }
  if (v.is(objectSchema, value)) {
    lines.push({ key, depth, text: null, kind: "object" });
    for (const [child, inner] of Object.entries(value)) {
      push(
        lines,
        child,
        v.parse(
          v.custom<JsonValue>(() => true),
          inner
        ),
        depth + 1
      );
    }
    return;
  }
  lines.push({ key, depth, text: valueText(value), kind: "value" });
}

/**
 * A document flattened for display, the way a document store's own console lays it out: one
 * line per field, nested fields indented under their parent, Extended JSON unwrapped first so
 * an id is its hex and a number its digits. Strings keep their quotes, so "10" and 10 differ.
 */
export function fieldLines(document: JsonObject): FieldLine[] {
  const lines: FieldLine[] = [];
  const shown = plain(document);
  if (!v.is(objectSchema, shown)) return lines;
  for (const [key, value] of Object.entries(shown)) {
    push(
      lines,
      key,
      v.parse(
        v.custom<JsonValue>(() => true),
        value
      ),
      0
    );
  }
  return lines;
}

/** What a document is called in the list: its `_id`, plain. */
export function documentId(row: JsonObject): string {
  return cellText(row["_id"]);
}
