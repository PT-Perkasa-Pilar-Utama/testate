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
import { quoteIdent } from "./pool.ts";
import { rowJson } from "./reader.ts";

const OPERATORS = {
  eq: "=",
  ne: "<>",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  like: "LIKE",
} as const satisfies Record<Exclude<FilterOp, "in" | "null" | "notnull">, string>;

const rowSchema = v.object({ j: v.string(), k: v.nullable(v.string()) });

type Clause = { sql: string; params: string[] };

function filterClause(query: PageQuery): Clause {
  const parts: string[] = [];
  const params: string[] = [];
  for (const filter of query.filters) {
    const column = `t.${quoteIdent(filter.column)}`;
    if (filter.op === "null" || filter.op === "notnull") {
      parts.push(`${column} IS ${filter.op === "null" ? "" : "NOT "}NULL`);
      continue;
    }
    if (filter.op === "in") {
      const values = filterValues(filter);
      parts.push(`${column} IN (${values.map(() => "?").join(", ")})`);
      params.push(...values);
      continue;
    }
    parts.push(`${column} ${OPERATORS[filter.op]} ?`);
    params.push(filter.value);
  }
  return { sql: parts.join(" AND "), params };
}

function keysetClause(query: PageQuery, keyColumns: string[]): Clause {
  if (query.cursor === undefined) return { sql: "", params: [] };
  const key = decodeKeysetCursor(query.cursor);
  if (key.length !== keyColumns.length)
    throw new EngineError("unsupported", "invalid cursor", { reason: "cursor" });
  const columns = keyColumns.map((name) => `t.${quoteIdent(name)}`).join(", ");
  return {
    sql: `(${columns}) ${query.order === "desc" ? "<" : ">"} (${key.map(() => "?").join(", ")})`,
    params: key.map((value) => (v.is(v.string(), value) ? value : JSON.stringify(value))),
  };
}

type Select = { text: string; params: string[]; keyset: boolean; offset: number };

function buildSelect(table: TableSchema, query: PageQuery): Select {
  const pk = table.primary_key ?? [];
  const keyset = pk.length > 0;
  const keyColumns =
    query.sort === undefined ? pk : [query.sort, ...pk.filter((name) => name !== query.sort)];
  const where = filterClause(query);
  const cursor = keyset ? keysetClause(query, keyColumns) : { sql: "", params: [] };
  const offset = keyset ? 0 : decodeOffsetCursor(query.cursor);
  const conditions = [where.sql, cursor.sql].filter((part) => part !== "");
  const direction = query.order === "desc" ? "DESC" : "ASC";
  const sortColumns = keyset ? keyColumns : [query.sort].filter((name) => name !== undefined);
  const orderBy = sortColumns.map((name) => `t.${quoteIdent(name)} ${direction}`).join(", ");
  const key = keyset
    ? `CAST(JSON_ARRAY(${keyColumns.map((name) => `t.${quoteIdent(name)}`).join(", ")}) AS CHAR)`
    : "NULL";
  const text = `SELECT ${rowJson(table)} AS j, ${key} AS k FROM ${quoteIdent(table.name)} t
    ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
    ${orderBy === "" ? "" : `ORDER BY ${orderBy}`} LIMIT ${query.limit + 1} OFFSET ${offset}`;
  return { text, params: [...where.params, ...cursor.params], keyset, offset };
}

export async function pageRows(sql: SQL, query: PageQuery): Promise<RowsPageResult> {
  const live = await introspect(sql, []);
  const table = live.tables.find((item) =>
    sameTable(item, { schema: null, name: query.table.name })
  );
  if (table === undefined)
    throw new EngineError("unsupported", `table ${query.table.name} not found`, {
      reason: "table",
    });
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
