import type { JsonObject, JsonValue } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

/**
 * MongoDB rows arrive in canonical Extended JSON, which keeps every type exact (`{"$numberLong":
 * "9007199254740993"}` never becomes a rounded number) and reads like a wire format. For a
 * person the wrapper is noise: an id is its hex, a number is its digits, a date is its ISO text.
 * This unwraps for display only; the row itself stays canonical for anything that writes it back.
 */
const object = v.record(v.string(), jsonValueSchema);
const text = v.string();
const dateMs = v.object({ $numberLong: v.string() });
const binary = v.object({ base64: v.string(), subType: v.optional(v.string()) });
const regex = v.object({ pattern: v.string(), options: v.optional(v.string()) });

type Unwrap = (inner: JsonValue) => JsonValue | undefined;

const asText: Unwrap = (inner) => (v.is(text, inner) ? inner : undefined);
const asNumber: Unwrap = (inner) => (v.is(text, inner) ? Number(inner) : undefined);
const asDate: Unwrap = (inner) => {
  if (v.is(text, inner)) return inner;
  return v.is(dateMs, inner) ? new Date(Number(inner.$numberLong)).toISOString() : undefined;
};
const asBinary: Unwrap = (inner) =>
  v.is(binary, inner) ? `binary, ${Math.floor((inner.base64.length * 3) / 4)} bytes` : undefined;
const asRegex: Unwrap = (inner) =>
  v.is(regex, inner) ? `/${inner.pattern}/${inner.options ?? ""}` : undefined;

/** Every wrapper canonical Extended JSON can produce, and what a person should see instead. */
const WRAPPERS = new Map<string, Unwrap>([
  ["$oid", asText],
  ["$symbol", asText],
  ["$uuid", asText],
  ["$code", asText],
  ["$numberLong", asText],
  ["$numberDecimal", asText],
  ["$numberInt", asNumber],
  ["$numberDouble", asNumber],
  ["$date", asDate],
  ["$binary", asBinary],
  ["$regularExpression", asRegex],
  ["$minKey", () => "MinKey"],
  ["$maxKey", () => "MaxKey"],
  ["$undefined", () => null],
]);

/** A one-key object that is a wrapper, unwrapped; anything else answers undefined. */
function unwrapped(value: { [key: string]: JsonValue }, keys: string[]): JsonValue | undefined {
  const single = keys[0];
  if (keys.length !== 1 || single === undefined) return undefined;
  const unwrap = WRAPPERS.get(single);
  return unwrap === undefined ? undefined : unwrap(value[single] ?? null);
}

/** The value as a person reads it: Extended JSON wrappers unwrapped, all the way down. */
export function plain(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(plain);
  if (!v.is(object, value)) return value;
  const keys = Object.keys(value);
  const shown = unwrapped(value, keys);
  if (shown !== undefined) return shown;
  const out: JsonObject = {};
  for (const key of keys) out[key] = plain(value[key] ?? null);
  return out;
}
