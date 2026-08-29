import type { JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import type { transformSchema } from "@testate/shared";
import * as v from "valibot";

import { createToolsService } from "../tools/tools.service.ts";

export type Transform = v.InferOutput<typeof transformSchema>;

const tools = createToolsService();

export class TransformError extends Error {}

function text(value: JsonValue): string {
  if (value === null) return "";
  return v.is(v.string(), value) ? value : JSON.stringify(value);
}

const DATE_TOKENS = new Set(["yyyy", "MM", "dd", "HH", "mm", "ss"]);

/** Named parts read from the source by the format's token positions (19 §19.1). */
function dateParts(input: string, format: string): Map<string, string> {
  const parts = new Map<string, string>();
  let cursor = 0;
  for (const token of format.match(/yyyy|MM|dd|HH|mm|ss|./g) ?? []) {
    if (DATE_TOKENS.has(token)) parts.set(token, input.slice(cursor, cursor + token.length));
    cursor += DATE_TOKENS.has(token) ? token.length : 1;
  }
  return parts;
}

function datePart(
  parts: Map<string, string>,
  token: string,
  fallback: string,
  max: number
): number {
  const value = Number(parts.get(token) ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TransformError("not a date");
  return value;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `dd/MM/yyyy`-style formats to ISO; a time appears only when the format carries hours. */
function parseDate(input: string, format: string, timezone: string | undefined): string {
  const parts = dateParts(input, format);
  const iso = `${pad(datePart(parts, "yyyy", "", 9999), 4)}-${pad(datePart(parts, "MM", "1", 12))}-${pad(datePart(parts, "dd", "1", 31))}`;
  const hours = parts.get("HH");
  if (hours === undefined) return iso;
  // ponytail: the zone is recorded, not applied — offsets need a tz database; UTC until then.
  return `${iso}T${hours}:${parts.get("mm") ?? "00"}:${parts.get("ss") ?? "00"}${timezone === undefined ? "" : "Z"}`;
}

function parseNumber(value: JsonValue, locale: string | undefined): number {
  const raw = text(value);
  const decimalComma = locale?.startsWith("id") === true || locale?.startsWith("de") === true;
  const normalized = decimalComma
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/,/g, "");
  const parsed = Number(normalized);
  if (normalized.trim() === "" || Number.isNaN(parsed)) throw new TransformError("not a number");
  return parsed;
}

function parseBoolean(
  value: JsonValue,
  transform: Extract<Transform, { kind: "boolean" }>
): boolean {
  const input = text(value).trim().toLowerCase();
  if (transform.trueValues.some((item) => item.toLowerCase() === input)) return true;
  if (transform.falseValues.some((item) => item.toLowerCase() === input)) return false;
  throw new TransformError("not a boolean");
}

function parseJson(value: JsonValue): JsonValue {
  try {
    return v.parse(jsonValueSchema, JSON.parse(text(value)));
  } catch {
    throw new TransformError("not valid JSON");
  }
}

type Applier = (value: JsonValue, transform: Transform) => Promise<JsonValue> | JsonValue;

const APPLIERS = {
  trim: (value) => text(value).trim(),
  emptyToNull: (value) => (text(value) === "" ? null : value),
  lowercase: (value) => text(value).toLowerCase(),
  uppercase: (value) => text(value).toUpperCase(),
  number: (value, transform) =>
    parseNumber(value, transform.kind === "number" ? transform.locale : undefined),
  date: (value, transform) =>
    transform.kind === "date"
      ? parseDate(text(value), transform.format, transform.timezone)
      : text(value),
  boolean: (value, transform) =>
    transform.kind === "boolean" ? parseBoolean(value, transform) : false,
  constant: (_value, transform) => (transform.kind === "constant" ? transform.value : null),
  uuid: () => Bun.randomUUIDv7(),
  now: () => new Date().toISOString(),
  json: (value) => parseJson(value),
  hash: (value, transform) => {
    if (transform.kind !== "hash") return text(value);
    const input: Parameters<typeof tools.hash>[0] = {
      algorithm: transform.algorithm,
      value: text(value),
    };
    if (transform.secret !== undefined) input.secret = transform.secret;
    return tools.hash(input);
  },
} satisfies Record<Transform["kind"], Applier>;

export async function applyTransform(value: JsonValue, transform: Transform): Promise<JsonValue> {
  return APPLIERS[transform.kind](value, transform);
}

/** Every transform of a mapping column in order; `null` short-circuits after `emptyToNull`. */
export async function applyTransforms(
  value: JsonValue,
  transforms: Transform[]
): Promise<JsonValue> {
  let current = value;
  for (const transform of transforms) {
    if (
      current === null &&
      transform.kind !== "constant" &&
      transform.kind !== "uuid" &&
      transform.kind !== "now"
    )
      continue;
    current = await applyTransform(current, transform);
  }
  return current;
}
