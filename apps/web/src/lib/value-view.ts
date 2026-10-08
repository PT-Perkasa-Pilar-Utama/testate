import type { JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { plain } from "./plain-value.ts";

const objectOrArray = v.union([v.record(v.string(), v.unknown()), v.array(v.unknown())]);
const text = v.string();

/**
 * Past this many characters a one-line cell is likely cut by its column, so it opens in full.
 * ponytail: a character count, not a measurement of the rendered width; a narrow string of capitals
 * may be cut below it. Measure the cell (`scrollWidth > clientWidth`) if that proves to matter.
 */
export const LONG_TEXT = 32;

/** What the full-value dialog shows: laid-out JSON, or text as it reads. */
export type FullValue = { kind: "json"; value: JsonValue } | { kind: "text"; text: string };

/** A string holding a JSON object or array, the common case of a JSON column read back as text. */
function parsedJson(value: string): JsonValue | undefined {
  if (!/^\s*[[{]/.test(value)) return undefined;
  try {
    const parsed = v.safeParse(jsonValueSchema, JSON.parse(value));
    return parsed.success && v.is(objectOrArray, parsed.output) ? parsed.output : undefined;
  } catch {
    return undefined;
  }
}

export function fullValueOf(raw: JsonValue): FullValue {
  const value = plain(raw);
  if (value === null) return { kind: "text", text: "NULL" };
  if (v.is(objectOrArray, value)) return { kind: "json", value };
  if (!v.is(text, value)) return { kind: "text", text: String(value) };
  const json = parsedJson(value);
  return json === undefined ? { kind: "text", text: value } : { kind: "json", value: json };
}

/** JSON laid out over lines; anything else as it reads. */
export function pretty(raw: JsonValue): string {
  const full = fullValueOf(raw);
  return full.kind === "json" ? JSON.stringify(full.value, null, 2) : full.text;
}

/** The value on one line, for a cell and its tooltip. */
export function oneLine(raw: JsonValue | undefined): string {
  if (raw === undefined || raw === null) return "NULL";
  const value = plain(raw);
  const shown = v.is(text, value) ? value : JSON.stringify(value);
  return shown.replaceAll(/\s*\n\s*/g, " ");
}

/** True when a cell cannot show the whole value: structured, multi-line, or long. */
export function needsViewer(raw: JsonValue | undefined): boolean {
  if (raw === undefined || raw === null) return false;
  if (fullValueOf(raw).kind === "json") return true;
  const value = plain(raw);
  return v.is(text, value) && (value.includes("\n") || value.length > LONG_TEXT);
}
