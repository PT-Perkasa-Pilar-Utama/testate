import type { Introspection, SchemaDrift, TableRef, TableSchema } from "@testate/shared";

import { tableKey } from "../types.ts";
import type { ColumnRef } from "../types.ts";
import { canonicalType } from "./fingerprint.ts";

type ColumnDrift = SchemaDrift["columns"];

function byKey(introspection: Introspection): Map<string, TableSchema> {
  return new Map(
    introspection.tables.filter((table) => !table.excluded).map((table) => [tableKey(table), table])
  );
}

function diffColumns(key: string, base: TableSchema, live: TableSchema, out: ColumnDrift): void {
  const baseColumns = new Map(base.columns.map((column) => [column.name, column]));
  const liveColumns = new Map(live.columns.map((column) => [column.name, column]));
  for (const [name, column] of liveColumns) {
    const before = baseColumns.get(name);
    if (before === undefined) {
      out.added.push({ table: key, column: name });
      continue;
    }
    if (canonicalType(before.type) !== canonicalType(column.type))
      out.type_changed.push({ table: key, column: name });
    if (before.nullable !== column.nullable)
      out.nullability_changed.push({ table: key, column: name });
  }
  for (const name of baseColumns.keys()) {
    if (!liveColumns.has(name)) out.removed.push({ table: key, column: name });
  }
}

/** What changed between a state's introspection and the live schema (14 §14.1). */
export function diffSchema(baseline: Introspection, live: Introspection): SchemaDrift {
  const base = byKey(baseline);
  const now = byKey(live);
  const drift: SchemaDrift = {
    changed: false,
    tables: { added: [], removed: [] },
    columns: { added: [], removed: [], type_changed: [], nullability_changed: [] },
  };
  for (const [key, table] of now) {
    const before = base.get(key);
    if (before === undefined) drift.tables.added.push(key);
    else diffColumns(key, before, table, drift.columns);
  }
  for (const key of base.keys()) if (!now.has(key)) drift.tables.removed.push(key);
  const { tables, columns } = drift;
  drift.changed =
    tables.added.length +
      tables.removed.length +
      columns.added.length +
      columns.removed.length +
      columns.type_changed.length +
      columns.nullability_changed.length >
    0;
  return drift;
}

export type ForceIntersection = {
  tables: TableRef[];
  skippedTables: TableRef[];
  skippedColumns: ColumnRef[];
  defaultedColumns: ColumnRef[];
};

const ref = (table: TableSchema): TableRef => ({ schema: table.schema, name: table.name });

/**
 * Force restore (14 §14.1): tables present on both sides, columns by name with equal canonical type;
 * a live column absent from the state must be nullable or have a default, else the table is skipped.
 */
export function forceIntersection(baseline: Introspection, live: Introspection): ForceIntersection {
  const base = byKey(baseline);
  const result: ForceIntersection = {
    tables: [],
    skippedTables: [],
    skippedColumns: [],
    defaultedColumns: [],
  };
  for (const [key, liveTable] of byKey(live)) {
    const before = base.get(key);
    if (before === undefined) continue;
    const baseColumns = new Map(before.columns.map((column) => [column.name, column]));
    const blockers = liveTable.columns.filter(
      (column) =>
        !baseColumns.has(column.name) &&
        !column.nullable &&
        !column.has_default &&
        !column.generated &&
        !column.identity
    );
    if (blockers.length > 0) {
      result.skippedTables.push(ref(liveTable));
      continue;
    }
    result.tables.push(ref(liveTable));
    for (const column of liveTable.columns) {
      const beforeColumn = baseColumns.get(column.name);
      if (beforeColumn === undefined) {
        if (!column.generated)
          result.defaultedColumns.push({ table: ref(liveTable), column: column.name });
      } else if (canonicalType(beforeColumn.type) !== canonicalType(column.type)) {
        result.skippedColumns.push({ table: ref(liveTable), column: column.name });
      }
    }
    for (const column of before.columns) {
      if (!liveTable.columns.some((item) => item.name === column.name)) {
        result.skippedColumns.push({ table: ref(liveTable), column: column.name });
      }
    }
  }
  return result;
}
