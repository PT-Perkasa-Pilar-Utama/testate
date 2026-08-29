import type { DiffRow, JsonObject, JsonValue } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import type { EncodedRow, SortKey } from "../engines/types.ts";

function sign(left: string | number, right: string | number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Tuples compare element-wise: numbers numerically, everything else by code point (20 §20.3). */
export function compareKeys(a: SortKey, b: SortKey): number {
  if (a.by === "row-hash" || b.by === "row-hash") return sign(String(a.value), String(b.value));
  const length = Math.max(a.value.length, b.value.length);
  for (let index = 0; index < length; index += 1) {
    const result = compareValue(a.value[index] ?? null, b.value[index] ?? null);
    if (result !== 0) return result;
  }
  return 0;
}

function compareValue(a: JsonValue, b: JsonValue): number {
  if (v.is(v.number(), a) && v.is(v.number(), b)) return sign(a, b);
  const left = v.is(v.string(), a) ? a : JSON.stringify(a);
  const right = v.is(v.string(), b) ? b : JSON.stringify(b);
  return sign(left, right);
}

function parseRow(row: EncodedRow): JsonObject {
  return v.parse(jsonObjectSchema, JSON.parse(row.json));
}

/** Columns whose JSON differs, plus columns that exist on one side only. */
export function changedColumns(before: JsonObject, after: JsonObject): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
    .sort();
}

export type MergeStats = { added: number; removed: number; changed: number };

async function next(iterator: AsyncIterator<EncodedRow>): Promise<EncodedRow | null> {
  const item = await iterator.next();
  return item.done ? null : item.value;
}

/** Negative: only the left row exists or sorts first; positive: only the right or it sorts first. */
function orderOf(a: EncodedRow | null, b: EncodedRow | null): number {
  if (a === null) return 1;
  if (b === null) return -1;
  return compareKeys(a.key, b.key);
}

function changedRow(a: EncodedRow, b: EncodedRow): DiffRow {
  const before = parseRow(a);
  const after = parseRow(b);
  return {
    k: a.key.value,
    op: "changed",
    before,
    after,
    changed_columns: changedColumns(before, after),
  };
}

/**
 * Streaming merge of two key-sorted row streams (20 §20.3). `changed` only exists for primary-key
 * tables; row-hash streams never share a key with a different body.
 */
export async function* mergeRows(
  base: AsyncIterable<EncodedRow>,
  target: AsyncIterable<EncodedRow>,
  stats: MergeStats
): AsyncIterable<DiffRow> {
  const left = base[Symbol.asyncIterator]();
  const right = target[Symbol.asyncIterator]();
  let a = await next(left);
  let b = await next(right);
  while (a !== null || b !== null) {
    const order = orderOf(a, b);
    if (a !== null && order < 0) {
      stats.removed += 1;
      yield { k: a.key.value, op: "removed", before: parseRow(a), after: null };
      a = await next(left);
      continue;
    }
    if (b !== null && order > 0) {
      stats.added += 1;
      yield { k: b.key.value, op: "added", before: null, after: parseRow(b) };
      b = await next(right);
      continue;
    }
    if (a !== null && b !== null && a.json !== b.json) {
      stats.changed += 1;
      yield changedRow(a, b);
    }
    a = await next(left);
    b = await next(right);
  }
}
