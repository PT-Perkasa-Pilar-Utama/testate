import * as v from "valibot";

import { AppError } from "../http/errors.ts";

/** `[value, id]`: the sort value of the last row on the page, and its id as the tiebreak. */
export type CursorKey = [string | number | null, string];

/**
 * Which ordering a cursor was minted under. A keyset cursor says "resume after this value", which
 * only means anything inside one order: replay a cursor from `sort=name` under `sort=created_at`
 * and the comparison runs against the wrong column, so the page silently skips or repeats rows.
 * The order therefore travels inside the cursor and a mismatch is refused.
 */
export type CursorOrder = { sort: string; order: "asc" | "desc" };

/** A list ordered by one column with the id as tiebreak; `idOrder` follows the ORDER BY. */
export type Keyset = CursorOrder & { column: string; id: string; idOrder: "asc" | "desc" };

const encodedSchema = v.tuple([
  v.union([v.string(), v.number(), v.null()]),
  v.string(),
  v.string(),
]);

function signature(ordering: CursorOrder): string {
  return `${ordering.sort}|${ordering.order}`;
}

export function encodeCursor(ordering: CursorOrder, key: CursorKey): string {
  const payload = JSON.stringify([key[0], key[1], signature(ordering)]);
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(ordering: CursorOrder, cursor: string): CursorKey {
  const invalid = new AppError("VALIDATION_ERROR", "invalid cursor", { reason: "cursor" });
  let decoded: v.InferOutput<typeof encodedSchema>;
  try {
    decoded = v.parse(encodedSchema, JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw invalid;
  }
  if (decoded[2] !== signature(ordering)) {
    throw new AppError("VALIDATION_ERROR", "the cursor belongs to a different order", {
      reason: "cursor",
    });
  }
  return [decoded[0], decoded[1]];
}

/**
 * The WHERE fragment that continues a keyset page after `cursor`; null without one. A null sort
 * value continues inside the null group only (SQLite sorts nulls first ascending).
 */
export function keysetCondition(
  keyset: Keyset,
  cursor: string | undefined
): { sql: string; params: (string | number)[] } | null {
  if (cursor === undefined) return null;
  const [value, id] = decodeCursor(keyset, cursor);
  const op = keyset.order === "desc" ? "<" : ">";
  const idOp = keyset.idOrder === "desc" ? "<" : ">";
  if (value === null)
    return { sql: `(${keyset.column} IS NULL AND ${keyset.id} ${idOp} ?)`, params: [id] };
  return {
    sql: `(${keyset.column} ${op} ? OR (${keyset.column} = ? AND ${keyset.id} ${idOp} ?))`,
    params: [value, value, id],
  };
}

/** The cursor for the page after `rows`, or null when the page came back short. */
export function nextCursor<T>(
  rows: T[],
  limit: number,
  ordering: CursorOrder,
  key: (row: T) => CursorKey
): string | null {
  const last = rows.at(-1);
  return rows.length < limit || last === undefined ? null : encodeCursor(ordering, key(last));
}
