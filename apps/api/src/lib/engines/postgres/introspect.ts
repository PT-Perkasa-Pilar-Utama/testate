import type { SQL } from "bun";
import type { Introspection, TableRef, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { computeFingerprint } from "../pure/fingerprint.ts";
import { isDefaultExcluded } from "../pure/excluded-tables.ts";
import { sameTable } from "../types.ts";
import { pgArray } from "./pool.ts";

/** A reserved connection or a pool: both accept `unsafe(text, params)`. */
export type Queryable = Pick<SQL, "unsafe">;

const HIDDEN_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

const tableRow = v.object({
  schema: v.string(),
  name: v.string(),
  relkind: v.string(),
  inherits: v.number(),
  reltuples: v.number(),
});

const columnRow = v.object({
  schema: v.string(),
  table_name: v.string(),
  name: v.string(),
  type: v.string(),
  nullable: v.boolean(),
  has_default: v.boolean(),
  generated: v.boolean(),
  identity: v.boolean(),
});

const constraintRow = v.object({
  schema: v.string(),
  table_name: v.string(),
  contype: v.string(),
  columns: v.array(v.string()),
  ref_schema: v.nullable(v.string()),
  ref_name: v.nullable(v.string()),
  ref_columns: v.nullable(v.array(v.string())),
  deferrable: v.boolean(),
});

const viewRow = v.object({ schema: v.string(), name: v.string() });

const TABLES = `
  SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind,
         (SELECT COUNT(*) FROM pg_inherits i WHERE i.inhrelid = c.oid)::int AS inherits,
         GREATEST(c.reltuples, 0)::float AS reltuples
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND n.nspname <> ALL($1::text[]) AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname`;

const COLUMNS = `
  SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS name,
         format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
         a.atthasdef AS has_default, a.attgenerated <> '' AS generated, a.attidentity <> '' AS identity
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND a.attnum > 0 AND NOT a.attisdropped
    AND n.nspname <> ALL($1::text[]) AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname, a.attnum`;

const CONSTRAINTS = `
  SELECT n.nspname AS schema, c.relname AS table_name, con.contype::text AS contype,
         ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord)::text[] AS columns,
         rn.nspname AS ref_schema, rc.relname AS ref_name,
         CASE WHEN con.contype = 'f' THEN ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord)::text[] END AS ref_columns,
         con.condeferrable AS deferrable
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_class rc ON rc.oid = con.confrelid LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
  WHERE con.contype IN ('p', 'u', 'f') AND n.nspname <> ALL($1::text[])
  ORDER BY n.nspname, c.relname, con.conname`;

const VIEWS = `
  SELECT n.nspname AS schema, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm') AND n.nspname <> ALL($1::text[]) ORDER BY 1, 2`;

const DISPLAY_CANDIDATES = ["name", "title", "label", "email", "username", "slug"];

function displayColumn(columns: TableSchema["columns"]): string | null {
  const textual = columns.filter((column) =>
    /^(text|character varying|varchar|citext)/.test(column.type)
  );
  return (
    textual.find((column) => DISPLAY_CANDIDATES.includes(column.name))?.name ??
    textual[0]?.name ??
    null
  );
}

type Rows = Iterable<unknown>;

function kindOf(row: v.InferOutput<typeof tableRow>): TableSchema["kind"] {
  if (row.relkind === "p") return "partition-parent";
  return row.inherits > 0 ? "inheritance-child" : "table";
}

function emptyTable(row: v.InferOutput<typeof tableRow>, excluded: TableRef[]): TableSchema {
  const ref: TableRef = { schema: row.schema, name: row.name };
  return {
    schema: row.schema,
    name: row.name,
    kind: kindOf(row),
    row_estimate: Math.round(row.reltuples),
    columns: [],
    primary_key: null,
    foreign_keys_out: [],
    foreign_keys_in: [],
    unique: [],
    unsupported: [],
    excluded: isDefaultExcluded(row.name) || excluded.some((item) => sameTable(item, ref)),
    display_column: null,
  };
}

/**
 * Types a snapshot cannot carry: a large object lives in `pg_largeobject`, and the column holds
 * only its oid, so restoring the column would point at content the state never took (14 §14.1).
 */
const UNSUPPORTED_TYPES = new Map([
  ["oid", "large object content lives outside the table; the state stores the reference only"],
  ["lo", "large object content lives outside the table; the state stores the reference only"],
]);

function markUnsupported(table: TableSchema): void {
  for (const column of table.columns) {
    const reason = UNSUPPORTED_TYPES.get(column.type.toLowerCase());
    if (reason !== undefined) table.unsupported.push({ column: column.name, reason });
  }
}

function addColumns(byKey: Map<string, TableSchema>, columns: Rows): void {
  for (const row of v.parse(v.array(columnRow), [...columns])) {
    byKey.get(`${row.schema}.${row.table_name}`)?.columns.push({
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      has_default: row.has_default,
      generated: row.generated,
      identity: row.identity,
      policy: { required_function: null, mask: null },
    });
  }
}

function addConstraint(
  byKey: Map<string, TableSchema>,
  row: v.InferOutput<typeof constraintRow>
): void {
  const table = byKey.get(`${row.schema}.${row.table_name}`);
  if (table === undefined) return;
  if (row.contype === "p") table.primary_key = row.columns;
  if (row.contype === "u") table.unique.push(row.columns);
  if (row.contype !== "f" || row.ref_schema === null || row.ref_name === null) return;
  const ref: TableRef = { schema: row.ref_schema, name: row.ref_name };
  table.foreign_keys_out.push({
    columns: row.columns,
    ref,
    ref_columns: row.ref_columns ?? [],
    deferrable: row.deferrable,
  });
  byKey.get(`${row.ref_schema}.${row.ref_name}`)?.foreign_keys_in.push({
    from: { schema: row.schema, name: row.table_name },
    columns: row.columns,
  });
}

/** Everything the fingerprint, the planner, and the grid need, in one pass of the catalog (12 §12.2). */
export async function introspect(
  sql: Queryable,
  excluded: TableRef[],
  schemas?: string[]
): Promise<Introspection> {
  const hidden = pgArray(HIDDEN_SCHEMAS);
  const [tables, columns, constraints, views] = await Promise.all([
    sql.unsafe(TABLES, [hidden]),
    sql.unsafe(COLUMNS, [hidden]),
    sql.unsafe(CONSTRAINTS, [hidden]),
    sql.unsafe(VIEWS, [hidden]),
  ]);
  const wantedSchema = (schema: string): boolean =>
    schemas === undefined || schemas.includes(schema);
  const byKey = new Map<string, TableSchema>();
  for (const row of v.parse(v.array(tableRow), [...tables])) {
    if (wantedSchema(row.schema)) byKey.set(`${row.schema}.${row.name}`, emptyTable(row, excluded));
  }
  addColumns(byKey, columns);
  for (const row of v.parse(v.array(constraintRow), [...constraints])) addConstraint(byKey, row);
  for (const table of byKey.values()) {
    table.display_column = displayColumn(table.columns);
    markUnsupported(table);
  }
  const introspection: Introspection = {
    tier: "tabular",
    fingerprint: "",
    tables: [...byKey.values()],
    views: v.parse(v.array(viewRow), [...views]).filter((row) => wantedSchema(row.schema)),
    warnings: [],
  };
  introspection.fingerprint = computeFingerprint(introspection);
  return introspection;
}
