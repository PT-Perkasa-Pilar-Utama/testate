import type { JsonValue } from "@testate/shared";
import * as v from "valibot";

const objectOrArray = v.union([v.record(v.string(), v.unknown()), v.array(v.unknown())]);
const text = v.string();

/** JSON gets laid out over lines; anything else is the value as it reads. */
export function pretty(value: JsonValue): string {
  if (value === null) return "NULL";
  if (v.is(objectOrArray, value)) return JSON.stringify(value, null, 2);
  if (!v.is(text, value)) return String(value);
  // A string holding JSON is the common case: a JSONB column read back as text.
  if (!/^\s*[[{]/.test(value)) return value;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export type Line = { text: string; side: "same" | "before" | "after" };

/** How many lines the two sides share at the start, and then at the end of what is left. */
type Shared = { head: number; tail: number };

function shared(left: readonly string[], right: readonly string[]): Shared {
  const shortest = Math.min(left.length, right.length);
  let head = 0;
  while (head < shortest && left[head] === right[head]) head += 1;
  let tail = 0;
  while (tail < shortest - head && left.at(-1 - tail) === right.at(-1 - tail)) tail += 1;
  return { head, tail };
}

function take(source: readonly string[], from: number, to: number, side: Line["side"]): Line[] {
  return source.slice(from, to).map((line) => ({ text: line, side }));
}

/**
 * The two values as lines, unified.
 *
 * Line by line, not character by character: a changed cell is usually a whole value or a JSON
 * document, and a character diff of a UUID is noise. Lines that match on both sides are shown
 * once, which is what makes a one-field change in a large document readable
 *.
 */
export function unified(before: JsonValue, after: JsonValue): Line[] {
  const left = pretty(before).split("\n");
  const right = pretty(after).split("\n");
  const { head, tail } = shared(left, right);
  return [
    ...take(left, 0, head, "same"),
    ...take(left, head, left.length - tail, "before"),
    ...take(right, head, right.length - tail, "after"),
    ...take(right, right.length - tail, right.length, "same"),
  ];
}
