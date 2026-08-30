import type { SQL } from "bun";
import type { JsonObject, JsonValue, TableSchema } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { EngineError, rowText, sameTable } from "../types.ts";
import type { RowOp, RowOpResult, RowValues, TableRef, WriteOptions } from "../types.ts";
import { translate } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { quoteIdent, quoteTable } from "./pool.ts";
import { swallow } from "./reader.ts";

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const returned = v.object({ j: v.string() });

/** JSON values bind as text and cast to the column type; objects and arrays go in as JSON text. */
function bindValue(value: JsonValue): string {
  if (value === null) return "NULL";
  return v.is(v.string(), value) ? value : JSON.stringify(value);
}

type Bound = { sql: string; params: string[] };

function typeOf(table: TableSchema, column: string): string {
  const found = table.columns.find((item) => item.name === column);
  if (found === undefined)
    throw new EngineError("unsupported", `unknown column ${column}`, { column, reason: "column" });
  return found.type;
}

/** `$n::type` per value, `DEFAULT` for defaults, `NULL` for nulls; params only for real values. */
type Binding = { placeholders: string[]; params: string[] };

function bindValues(table: TableSchema, values: RowValues, offset: number): Binding {
  const placeholders: string[] = [];
  const params: string[] = [];
  for (const [column, value] of Object.entries(values)) {
    const type = typeOf(table, column);
    if (value.kind === "default") {
      placeholders.push("DEFAULT");
      continue;
    }
    if (value.value === null) {
      placeholders.push("NULL");
      continue;
    }
    params.push(bindValue(value.value));
    placeholders.push(`$${offset + params.length}::${type}`);
  }
  return { placeholders, params };
}

function whereKey(table: TableSchema, pk: JsonObject, offset: number): Bound {
  const parts: string[] = [];
  const params: string[] = [];
  for (const [column, value] of Object.entries(pk)) {
    params.push(bindValue(value));
    parts.push(`${quoteIdent(column)} = $${offset + params.length}::${typeOf(table, column)}`);
  }
  if (parts.length === 0)
    throw new EngineError("unsupported", "a primary key is required", { reason: "pk" });
  return { sql: parts.join(" AND "), params };
}

function statementFor(table: TableSchema, op: RowOp): Bound {
  const target = quoteTable(table.schema, table.name);
  if (op.kind === "insert") {
    const columns = Object.keys(op.values).map(quoteIdent).join(", ");
    const bound = bindValues(table, op.values, 0);
    return {
      sql: `INSERT INTO ${target} AS t (${columns}) VALUES (${bound.placeholders.join(", ")}) RETURNING to_jsonb(t)::text AS j`,
      params: bound.params,
    };
  }
  if (op.kind === "update") {
    const bound = bindValues(table, op.values, 0);
    const sets = Object.keys(op.values).map(
      (column, index) => `${quoteIdent(column)} = ${bound.placeholders[index] ?? "DEFAULT"}`
    );
    const key = whereKey(table, op.pk, bound.params.length);
    return {
      sql: `UPDATE ${target} AS t SET ${sets.join(", ")} WHERE ${key.sql} RETURNING to_jsonb(t)::text AS j`,
      params: [...bound.params, ...key.params],
    };
  }
  const key = whereKey(table, op.pk, 0);
  return {
    sql: `DELETE FROM ${target} AS t WHERE ${key.sql} RETURNING to_jsonb(t)::text AS j`,
    params: key.params,
  };
}

function keyOf(table: TableSchema, op: RowOp, row: JsonObject | null): JsonObject {
  if (op.kind !== "insert") return op.pk;
  const pk: JsonObject = {};
  for (const column of table.primary_key ?? []) pk[column] = row?.[column] ?? null;
  return pk;
}

/**
 * Foreign-key checks off (24 §24.5): deferred constraints for the transaction, else the replica
 * role when the role may set it. ponytail: the deferrable check is per attempt, not per constraint;
 * name the non-deferrable constraints once introspection carries them.
 */
async function relaxForeignKeys(conn: Reserved): Promise<void> {
  try {
    await conn.unsafe("SET LOCAL session_replication_role = replica");
  } catch {
    await conn.unsafe("SET CONSTRAINTS ALL DEFERRED");
  }
}

async function runOps(
  conn: Reserved,
  table: TableSchema,
  ops: RowOp[],
  signal: AbortSignal | undefined
): Promise<RowOpResult[]> {
  const results: RowOpResult[] = [];
  for (const [index, op] of ops.entries()) {
    if (signal?.aborted) throw new EngineError("cancelled", "edit cancelled");
    const statement = statementFor(table, op);
    let rows: unknown[];
    try {
      rows = [...(await conn.unsafe(statement.sql, statement.params))];
    } catch (cause: unknown) {
      const error = translate(cause, `edit ${index}`);
      throw new EngineError(error.kind, error.message, {
        ...error.details,
        failed_index: index,
        engine_message: error.message,
      });
    }
    const first = rows[0];
    if (first === undefined) {
      throw new EngineError("batch_failed", `edit ${index} matched no row`, {
        failed_index: index,
        engine_message: "no row matched",
      });
    }
    const json = v.parse(returned, first).j;
    const row = v.parse(jsonObjectSchema, JSON.parse(json));
    results.push({
      kind: op.kind,
      pk: keyOf(table, op, row),
      row: op.kind === "delete" ? null : rowText(json),
    });
  }
  return results;
}

/** All ops in one transaction on a reserved connection; any failure rolls everything back (06 §6.6). */
export async function writeRows(
  sql: SQL,
  ref: TableRef,
  ops: RowOp[],
  opts: WriteOptions,
  schemas?: string[]
): Promise<RowOpResult[]> {
  const live = await introspect(sql, [], schemas);
  const table = live.tables.find((item) => sameTable(item, ref));
  if (table === undefined)
    throw new EngineError("unsupported", `table ${ref.name} not found`, { reason: "table" });
  const conn = await sql.reserve();
  try {
    await conn.unsafe("BEGIN");
    await conn.unsafe("SET LOCAL TIME ZONE 'UTC'");
    if (!opts.foreignKeyChecks) await relaxForeignKeys(conn);
    const results = await runOps(conn, table, ops, opts.signal);
    await conn.unsafe("COMMIT");
    return results;
  } catch (cause: unknown) {
    await swallow(conn.unsafe("ROLLBACK"));
    throw cause instanceof EngineError ? cause : translate(cause, "edit");
  } finally {
    conn.release();
  }
}
