import type { SQL } from "bun";
import type { Introspection, TableRef, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { isDefaultExcluded } from "../pure/excluded-tables.ts";
import { computeFingerprint } from "../pure/fingerprint.ts";
import { sameTable } from "../types.ts";

export type Queryable = Pick<SQL, "unsafe">;

const tableRow = v.object({
  name: v.string(),
  kind: v.string(),
  rows: v.nullable(v.number()),
  engine: v.nullable(v.string()),
});

const columnRow = v.object({
  table_name: v.string(),
  name: v.string(),
  type: v.string(),
  nullable: v.string(),
  has_default: v.number(),
  extra: v.string(),
});

const constraintRow = v.object({
  table_name: v.string(),
  constraint_name: v.string(),
  kind: v.string(),
  column_name: v.string(),
  ref_table: v.nullable(v.string()),
  ref_column: v.nullable(v.string()),
});

const viewRow = v.object({ name: v.string() });

const TABLES = `
  SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, TABLE_ROWS AS \`rows\`, ENGINE AS engine
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;

const COLUMNS = `
  SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
         (COLUMN_DEFAULT IS NOT NULL OR EXTRA LIKE '%auto_increment%' OR EXTRA LIKE '%DEFAULT_GENERATED%') AS has_default,
         EXTRA AS extra
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`;

const CONSTRAINTS = `
  SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS constraint_name, t.CONSTRAINT_TYPE AS kind,
         k.COLUMN_NAME AS column_name, k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.TABLE_CONSTRAINTS t
    ON t.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND t.TABLE_NAME = k.TABLE_NAME
  WHERE k.TABLE_SCHEMA = DATABASE() AND t.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
  ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`;

const DISPLAY_CANDIDATES = ["name", "title", "label", "email", "username", "slug"];

function displayColumn(columns: TableSchema["columns"]): string | null {
  const textual = columns.filter((column) =>
    /^(varchar|char|text|tinytext|mediumtext|longtext)/.test(column.type)
  );
  return (
    textual.find((column) => DISPLAY_CANDIDATES.includes(column.name))?.name ??
    textual[0]?.name ??
    null
  );
}

function emptyTable(row: v.InferOutput<typeof tableRow>, excluded: TableRef[]): TableSchema {
  const ref: TableRef = { schema: null, name: row.name };
  const unsupported =
    row.engine !== null && row.engine !== "InnoDB"
      ? [{ column: "*", reason: `non-transactional engine ${row.engine}` }]
      : [];
  return {
    schema: null,
    name: row.name,
    kind: "table",
    row_estimate: row.rows ?? 0,
    columns: [],
    primary_key: null,
    foreign_keys_out: [],
    foreign_keys_in: [],
    unique: [],
    unsupported,
    excluded: isDefaultExcluded(row.name) || excluded.some((item) => sameTable(item, ref)),
    display_column: null,
  };
}

function addColumns(byName: Map<string, TableSchema>, rows: Iterable<unknown>): void {
  for (const row of v.parse(v.array(columnRow), [...rows])) {
    byName.get(row.table_name)?.columns.push({
      name: row.name,
      type: row.type,
      nullable: row.nullable === "YES",
      has_default: row.has_default === 1,
      generated: /GENERATED/i.test(row.extra) && !/DEFAULT_GENERATED/i.test(row.extra),
      identity: /auto_increment/i.test(row.extra),
      policy: { required_function: null, mask: null },
    });
  }
}

type ConstraintGroup = v.InferOutput<typeof constraintRow>[];

function applyGroup(byName: Map<string, TableSchema>, group: ConstraintGroup): void {
  const first = group[0];
  const table = first === undefined ? undefined : byName.get(first.table_name);
  if (first === undefined || table === undefined) return;
  const columns = group.map((row) => row.column_name);
  if (first.kind === "PRIMARY KEY") table.primary_key = columns;
  if (first.kind === "UNIQUE") table.unique.push(columns);
  if (first.kind !== "FOREIGN KEY" || first.ref_table === null) return;
  const ref: TableRef = { schema: null, name: first.ref_table };
  table.foreign_keys_out.push({
    columns,
    ref,
    ref_columns: group.map((row) => row.ref_column ?? ""),
    deferrable: false,
  });
  byName
    .get(first.ref_table)
    ?.foreign_keys_in.push({ from: { schema: null, name: first.table_name }, columns });
}

/** Multi-column constraints arrive one column per row; they are folded by constraint name. */
function addConstraints(byName: Map<string, TableSchema>, rows: Iterable<unknown>): void {
  const groups = new Map<string, ConstraintGroup>();
  for (const row of v.parse(v.array(constraintRow), [...rows])) {
    const key = `${row.table_name}|${row.constraint_name}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) applyGroup(byName, group);
}

/** One pass over information_schema for the current database (12 §12.2); views listed separately. */
export async function introspect(sql: Queryable, excluded: TableRef[]): Promise<Introspection> {
  const [tables, columns, constraints] = await Promise.all([
    sql.unsafe(TABLES),
    sql.unsafe(COLUMNS),
    sql.unsafe(CONSTRAINTS),
  ]);
  const byName = new Map<string, TableSchema>();
  const views: v.InferOutput<typeof viewRow>[] = [];
  for (const row of v.parse(v.array(tableRow), [...tables])) {
    if (row.kind === "VIEW") views.push({ name: row.name });
    else byName.set(row.name, emptyTable(row, excluded));
  }
  addColumns(byName, columns);
  addConstraints(byName, constraints);
  for (const table of byName.values()) table.display_column = displayColumn(table.columns);
  const introspection: Introspection = {
    tier: "tabular",
    fingerprint: "",
    tables: [...byName.values()],
    views: views.map((view) => ({ schema: null, name: view.name })),
    warnings: [],
  };
  introspection.fingerprint = computeFingerprint(introspection);
  return introspection;
}
