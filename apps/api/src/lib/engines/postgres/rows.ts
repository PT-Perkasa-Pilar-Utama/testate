import type { SQL } from "bun";
import type { TableSchema } from "@testate/shared";
import * as v from "valibot";

import {
  assertColumns,
  decodeKeysetCursor,
  decodeOffsetCursor,
  encodeKeysetCursor,
  filterValues,
} from "../pure/page.ts";
import { EngineError, rowText, sameTable } from "../types.ts";
import type { FilterOp, PageQuery, RowsPageResult } from "../types.ts";
import { introspect } from "./introspect.ts";
import { quoteIdent, quoteTable } from "./pool.ts";

const OPERATORS = {
  eq: "=",
  ne: "<>",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  like: "ILIKE",
} as const satisfies Record<Exclude<FilterOp, "in" | "null" | "notnull">, string>;

const rowSchema = v.object({ j: v.string(), k: v.nullable(v.string()) });

type Clause = { sql: string; params: string[] };

/** Every value binds as text and casts to the column type server-side, so `1` and `'1'` behave alike. */
function filterClause(query: PageQuery, table: TableSchema, offset: number): Clause {
  const parts: string[] = [];
  const params: string[] = [];
  let index = offset;
  for (const filter of query.filters) {
    const type = table.columns.find((column) => column.name === filter.column)?.type ?? "text";
    const column = `t.${quoteIdent(filter.column)}`;
    if (filter.op === "null" || filter.op === "notnull") {
      parts.push(`${column} IS ${filter.op === "null" ? "" : "NOT "}NULL`);
      continue;
    }
    if (filter.op === "in") {
      const values = filterValues(filter);
      parts.push(`${column} IN (${values.map(() => `$${(index += 1)}::${type}`).join(", ")})`);
      params.push(...values);
      continue;
    }
    const cast = filter.op === "like" ? "text" : type;
    parts.push(
      `${column}${filter.op === "like" ? "::text" : ""} ${OPERATORS[filter.op]} $${(index += 1)}::${cast}`
    );
    params.push(filter.value);
  }
  return { sql: parts.join(" AND "), params };
}

/** `(a, b) > ($n, $m)` on the sort tuple: the sort column when given, then the primary key. */
function keysetClause(
  table: TableSchema,
  query: PageQuery,
  keyColumns: string[],
  offset: number
): Clause {
  if (query.cursor === undefined) return { sql: "", params: [] };
  const key = decodeKeysetCursor(query.cursor);
  if (key.length !== keyColumns.length)
    throw new EngineError("unsupported", "invalid cursor", { reason: "cursor" });
  const columns = keyColumns.map((name) => `t.${quoteIdent(name)}`).join(", ");
  const binds = keyColumns
    .map((name, position) => {
      const type = table.columns.find((column) => column.name === name)?.type ?? "text";
      return `$${offset + position + 1}::${type}`;
    })
    .join(", ");
  return {
    sql: `(${columns}) ${query.order === "desc" ? "<" : ">"} (${binds})`,
    params: key.map((value) => (v.is(v.string(), value) ? value : JSON.stringify(value))),
  };
}

type Select = { text: string; params: string[]; keyset: boolean; offset: number };

/** The statement for one page: filters, then the keyset or offset window, then the order (06 §6.2). */
function buildSelect(table: TableSchema, query: PageQuery): Select {
  const pk = table.primary_key ?? [];
  const keyset = pk.length > 0;
  const keyColumns =
    query.sort === undefined ? pk : [query.sort, ...pk.filter((name) => name !== query.sort)];
  const where = filterClause(query, table, 0);
  const cursor = keyset
    ? keysetClause(table, query, keyColumns, where.params.length)
    : { sql: "", params: [] };
  const offset = keyset ? 0 : decodeOffsetCursor(query.cursor);
  const conditions = [where.sql, cursor.sql].filter((part) => part !== "");
  const direction = query.order === "desc" ? "DESC" : "ASC";
  const sortColumns = keyset ? keyColumns : [query.sort].filter((name) => name !== undefined);
  const orderBy = sortColumns.map((name) => `t.${quoteIdent(name)} ${direction}`).join(", ");
  const key = keyset
    ? `jsonb_build_array(${keyColumns.map((name) => `t.${quoteIdent(name)}`).join(", ")})::text`
    : "NULL::text";
  const text = `SELECT to_jsonb(t)::text AS j, ${key} AS k FROM ${quoteTable(table.schema, table.name)} t
    ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
    ${orderBy === "" ? "" : `ORDER BY ${orderBy}`} LIMIT ${query.limit + 1} OFFSET ${offset}`;
  return { text, params: [...where.params, ...cursor.params], keyset, offset };
}

export async function pageRows(
  sql: SQL,
  query: PageQuery,
  schemas?: string[]
): Promise<RowsPageResult> {
  const live = await introspect(sql, [], schemas);
  const table = live.tables.find((item) => sameTable(item, query.table));
  if (table === undefined) {
    throw new EngineError("unsupported", `table ${query.table.name} not found`, {
      reason: "table",
    });
  }
  assertColumns(table, query);
  const select = buildSelect(table, query);
  const rows = v.parse(v.array(rowSchema), [...(await sql.unsafe(select.text, select.params))]);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (rows.length > query.limit && last !== undefined) {
    nextCursor = select.keyset
      ? encodeKeysetCursor(JSON.parse(last.k ?? "[]"))
      : String(select.offset + query.limit);
  }
  return {
    rows: page.map((row) => rowText(row.j)),
    columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
    nextCursor,
    kind: select.keyset ? "keyset" : "offset",
  };
}
