import * as v from "valibot";

import { AppError } from "../http/errors.ts";

const cursorSchema = v.tuple([v.union([v.string(), v.number(), v.null()]), v.string()]);
export type CursorKey = v.InferOutput<typeof cursorSchema>;

/** A list ordered by one column with the id as tiebreak; `idOrder` follows the ORDER BY. */
export type Keyset = {
  column: string;
  id: string;
  order: "asc" | "desc";
  idOrder: "asc" | "desc";
};

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorKey {
  try {
    return v.parse(cursorSchema, JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new AppError("VALIDATION_ERROR", "invalid cursor", { reason: "cursor" });
  }
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
  const [value, id] = decodeCursor(cursor);
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
export function nextCursor<T>(rows: T[], limit: number, key: (row: T) => CursorKey): string | null {
  const last = rows.at(-1);
  return rows.length < limit || last === undefined ? null : encodeCursor(key(last));
}
