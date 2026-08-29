import type { TableSchema } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { EngineError } from "../types.ts";
import type { PageQuery, RowFilter } from "../types.ts";

/** Unknown columns are a validation error before any SQL is built (06 §6.2). */
export function assertColumns(table: TableSchema, query: PageQuery): void {
  const names = new Set(table.columns.map((column) => column.name));
  const wanted = [query.sort, ...query.filters.map((filter) => filter.column)];
  for (const name of wanted) {
    if (name !== undefined && !names.has(name)) {
      throw new EngineError("unsupported", `unknown column ${name}`, {
        column: name,
        reason: "column",
      });
    }
  }
}

const cursorSchema = v.array(jsonValueSchema);

/** Keyset cursors carry the last row's key; offset cursors carry a number. */
export function decodeKeysetCursor(cursor: string): v.InferOutput<typeof cursorSchema> {
  try {
    return v.parse(cursorSchema, JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new EngineError("unsupported", "invalid cursor", { reason: "cursor" });
  }
}

export function encodeKeysetCursor(key: v.InferOutput<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = v.safeParse(v.pipe(v.number(), v.integer(), v.minValue(0)), Number(cursor));
  if (!parsed.success) throw new EngineError("unsupported", "invalid cursor", { reason: "cursor" });
  return parsed.output;
}

/** Splits `in` lists once so every engine agrees on the comma rule. */
export function filterValues(filter: RowFilter): string[] {
  return filter.op === "in" ? filter.value.split(",") : [filter.value];
}
