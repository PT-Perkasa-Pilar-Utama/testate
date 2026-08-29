import type { Introspection, JsonValue, TableSchema } from "@testate/shared";

import { sameTable } from "../../lib/engines/index.ts";
import type { ConnectionRef, DbEngine, PageQuery, RowFilter } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";

export type LookupRow = { key: JsonValue[]; display: string };

export type LookupTarget = { table: TableSchema; keyColumns: string[]; display: string | null };

/** The referenced table of an FK column, or `VALIDATION_ERROR` (06 §6.3). */
export function lookupTarget(
  schema: Introspection,
  table: TableSchema,
  column: string,
  displayOverride: string | null
): LookupTarget {
  const fk = table.foreign_keys_out.find(
    (item) => item.columns.length === 1 && item.columns[0] === column
  );
  const target =
    fk === undefined ? undefined : schema.tables.find((item) => sameTable(item, fk.ref));
  if (fk === undefined || target === undefined) {
    throw new AppError("VALIDATION_ERROR", "not a foreign key column", { column });
  }
  return {
    table: target,
    keyColumns: fk.ref_columns,
    display: displayOverride ?? target.display_column,
  };
}

/** Prefix on the key or the display column; the engine pages both with one `like` (24 §24.1). */
export async function lookupRows(
  engine: DbEngine,
  conn: ConnectionRef,
  target: LookupTarget,
  q: string,
  limit: number
): Promise<LookupRow[]> {
  const column = target.display ?? target.keyColumns[0] ?? "";
  const filters: RowFilter[] = q === "" ? [] : [{ column, op: "like", value: `${q}%` }];
  const query: PageQuery = {
    table: { schema: target.table.schema, name: target.table.name },
    limit,
    order: "asc",
    filters,
  };
  const page = await engine.pageRows(conn, query);
  return page.rows.map((text) => {
    const row = engine.decodeRow(text);
    return {
      key: target.keyColumns.map((name) => row[name] ?? null),
      display: String(row[target.display ?? column] ?? ""),
    };
  });
}
