import type { Actor, ColumnPolicy, Fixture, Introspection, JsonObject, JsonValue, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { computeDependencyOrder, sameTable, tableKey } from "../../lib/engines/index.ts";
import type { ConnectionRef, DbEngine, RowFilter } from "../../lib/engines/index.ts";
import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import { maskRows } from "./data.masks.ts";

export type FixtureRequest = {
  table: string;
  pk: JsonObject;
  depth: number;
  direction: "parents" | "children" | "both";
  format: "sql" | "json";
};

export type FixtureDeps = {
  engine: DbEngine;
  conn: ConnectionRef;
  schema: Introspection;
  policies: ColumnPolicy[];
  actor: Actor;
  adapterName: string;
  engineName: string;
  now: () => Date;
};

const ROW_CAP = 500;

type Visit = { table: TableSchema; key: JsonObject; depth: number };
type Collected = Map<string, { table: TableSchema; rows: Map<string, JsonObject> }>;

function tableOf(schema: Introspection, ref: string): TableSchema {
  const dot = ref.indexOf(".");
  const wanted = dot === -1 ? { schema: null, name: ref } : { schema: ref.slice(0, dot), name: ref.slice(dot + 1) };
  const found = schema.tables.find((table) => sameTable(table, wanted) || (wanted.schema === null && table.name === wanted.name));
  if (found === undefined) throw notFound("table");
  return found;
}

function filtersOf(key: JsonObject): RowFilter[] {
  return Object.entries(key).map(([column, value]) => ({
    column,
    op: "eq",
    value: v.is(v.string(), value) ? value : JSON.stringify(value),
  }));
}

async function fetchRows(deps: FixtureDeps, table: TableSchema, key: JsonObject, limit: number): Promise<JsonObject[]> {
  const page = await deps.engine.pageRows(deps.conn, {
    table: { schema: table.schema, name: table.name },
    limit,
    order: "asc",
    filters: filtersOf(key),
  });
  return page.rows.map((row) => deps.engine.decodeRow(row));
}

function keyOf(table: TableSchema, row: JsonObject): JsonObject {
  const key: JsonObject = {};
  for (const column of table.primary_key ?? []) key[column] = row[column] ?? null;
  return key;
}

type Walk = {
  collected: Collected;
  queue: Visit[];
  seen: Set<string>;
  total: number;
  parents: boolean;
  children: boolean;
  depth: number;
};

/** One table visit: fetch, dedupe, and enqueue the next hop when depth allows. */
async function visitOne(deps: FixtureDeps, walk: Walk, visit: Visit): Promise<void> {
  const rows = await fetchRows(deps, visit.table, visit.key, ROW_CAP - walk.total);
  if (rows.length === 0 && visit.depth === 0) throw notFound("row");
  const key = tableKey(visit.table);
  const bucket = walk.collected.get(key) ?? { table: visit.table, rows: new Map<string, JsonObject>() };
  for (const row of rows) {
    const id = JSON.stringify(keyOf(visit.table, row));
    if (bucket.rows.has(id)) continue;
    bucket.rows.set(id, row);
    walk.total += 1;
    if (visit.depth >= walk.depth) continue;
    if (walk.parents) enqueueParents(deps.schema, visit, row, walk.queue);
    if (walk.children) enqueueChildren(deps.schema, visit, row, walk.queue);
  }
  walk.collected.set(key, bucket);
}

/** Breadth-first over foreign keys (24 §24.6), stopping at the row cap. */
async function collect(
  deps: FixtureDeps,
  request: FixtureRequest
): Promise<{ collected: Collected; truncated: boolean }> {
  const root = tableOf(deps.schema, request.table);
  if (root.primary_key === null) throw conflict("the table has no primary key");
  const walk: Walk = {
    collected: new Map(),
    queue: [{ table: root, key: request.pk, depth: 0 }],
    seen: new Set(),
    total: 0,
    parents: request.direction !== "children",
    children: request.direction !== "parents",
    depth: request.depth,
  };
  for (let visit = walk.queue.shift(); visit !== undefined; visit = walk.queue.shift()) {
    const mark = `${tableKey(visit.table)}:${JSON.stringify(visit.key)}`;
    if (walk.seen.has(mark)) continue;
    walk.seen.add(mark);
    if (walk.total >= ROW_CAP) return { collected: walk.collected, truncated: true };
    await visitOne(deps, walk, visit);
  }
  return { collected: walk.collected, truncated: false };
}

function enqueueParents(schema: Introspection, visit: Visit, row: JsonObject, queue: Visit[]): void {
  for (const fk of visit.table.foreign_keys_out) {
    const parent = schema.tables.find((table) => sameTable(table, fk.ref));
    if (parent === undefined) continue;
    const key: JsonObject = {};
    let missing = false;
    for (const [index, column] of fk.ref_columns.entries()) {
      const value = row[fk.columns[index] ?? ""] ?? null;
      if (value === null) missing = true;
      key[column] = value;
    }
    if (!missing) queue.push({ table: parent, key, depth: visit.depth + 1 });
  }
}

function enqueueChildren(schema: Introspection, visit: Visit, row: JsonObject, queue: Visit[]): void {
  for (const fk of visit.table.foreign_keys_in) {
    const child = schema.tables.find((table) => sameTable(table, fk.from));
    const back = child?.foreign_keys_out.find((item) => sameTable(item.ref, visit.table) && item.columns.join() === fk.columns.join());
    if (child === undefined || back === undefined) continue;
    const key: JsonObject = {};
    for (const [index, column] of fk.columns.entries()) key[column] = row[back.ref_columns[index] ?? ""] ?? null;
    queue.push({ table: child, key, depth: visit.depth + 1 });
  }
}

function literal(value: JsonValue): string {
  if (value === null) return "NULL";
  if (v.is(v.boolean(), value)) return value ? "TRUE" : "FALSE";
  if (v.is(v.number(), value)) return String(value);
  const text = v.is(v.string(), value) ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function toSql(table: TableSchema, rows: JsonObject[]): string {
  const columns = table.columns.map((column) => column.name);
  const target = table.schema === null ? `"${table.name}"` : `"${table.schema}"."${table.name}"`;
  return rows
    .map((row) => `INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")}) VALUES (${columns.map((name) => literal(row[name] ?? null)).join(", ")});`)
    .join("\n");
}

/** Rows in dependency order, parents first, masked per role; SQL or JSON (24 §24.6). */
export async function extractFixture(deps: FixtureDeps, request: FixtureRequest): Promise<Fixture> {
  const { collected, truncated } = await collect(deps, request);
  const refs = [...collected.values()].map((bucket) => ({ schema: bucket.table.schema, name: bucket.table.name }));
  const order = computeDependencyOrder(deps.schema.tables, refs).order;
  const maskedColumns = new Set<string>();
  const sections: { table: TableSchema; rows: JsonObject[] }[] = [];
  for (const ref of order) {
    const bucket = collected.get(tableKey(ref));
    if (bucket === undefined) continue;
    const policies = deps.policies.filter((policy) => policy.table === tableKey(ref));
    const masked = maskRows(deps.actor, [...bucket.rows.values()], policies);
    for (const column of masked.masked_columns) maskedColumns.add(`${tableKey(ref)}.${column}`);
    sections.push({ table: bucket.table, rows: masked.rows });
  }
  const rows = sections.reduce((total, section) => total + section.rows.length, 0);
  const tables = sections.map((section) => tableKey(section.table));
  if (request.format === "json") {
    const content = JSON.stringify({
      adapter: deps.adapterName,
      engine: deps.engineName,
      extracted_at: deps.now().toISOString(),
      masked_columns: [...maskedColumns],
      tables: sections.map((section) => ({
        table: tableKey(section.table),
        columns: section.table.columns.map((column) => column.name),
        rows: section.rows,
      })),
    });
    return { format: "json", content, rows, tables, truncated, masked_columns: [...maskedColumns] };
  }
  const content = `${sections.map((section) => toSql(section.table, section.rows)).join("\n")}\n`;
  return { format: "sql", content, rows, tables, truncated, masked_columns: [...maskedColumns] };
}

export { AppError };
