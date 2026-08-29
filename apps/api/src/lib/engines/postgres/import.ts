import type { SQL } from "bun";
import type { TableSchema } from "@testate/shared";
import * as v from "valibot";

import { EngineError, sameTable } from "../types.ts";
import type { ImportBatchResult, ImportOptions, RowValues, TableRef } from "../types.ts";
import { translate } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { quoteIdent, quoteTable } from "./pool.ts";
import { swallow } from "./reader.ts";

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const insertedRow = v.object({ inserted: v.boolean() });

type Statement = { sql: string; params: string[] };

function bind(value: RowValues[string]): string | null {
  if (value.kind === "default" || value.value === null) return null;
  return v.is(v.string(), value.value) ? value.value : JSON.stringify(value.value);
}

/** One multi-row INSERT; upsert adds `ON CONFLICT (keys) DO UPDATE`; `xmax = 0` tells inserts from updates. */
function statementFor(table: TableSchema, rows: RowValues[], opts: ImportOptions): Statement {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const types = new Map(table.columns.map((column) => [column.name, column.type]));
  const params: string[] = [];
  const tuples = rows.map((row) => {
    const cells = columns.map((column) => {
      const value = row[column];
      if (value === undefined || value.kind === "default") return "DEFAULT";
      const bound = bind(value);
      if (bound === null) return "NULL";
      params.push(bound);
      return `$${params.length}::${types.get(column) ?? "text"}`;
    });
    return `(${cells.join(", ")})`;
  });
  const target = quoteTable(table.schema, table.name);
  const names = columns.map(quoteIdent).join(", ");
  let conflict = "";
  if (opts.mode === "upsert") {
    const updates = columns
      .filter((column) => !opts.keyColumns.includes(column))
      .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`);
    conflict = ` ON CONFLICT (${opts.keyColumns.map(quoteIdent).join(", ")}) DO ${updates.length === 0 ? "NOTHING" : `UPDATE SET ${updates.join(", ")}`}`;
  }
  return {
    sql: `INSERT INTO ${target} AS t (${names}) VALUES ${tuples.join(", ")}${conflict} RETURNING (xmax = 0) AS inserted`,
    params,
  };
}

async function runBatch(
  conn: Reserved,
  table: TableSchema,
  rows: RowValues[],
  opts: ImportOptions
): Promise<ImportBatchResult> {
  const statement = statementFor(table, rows, opts);
  const returned = v.parse(v.array(insertedRow), [
    ...(await conn.unsafe(statement.sql, statement.params)),
  ]);
  const inserted = returned.filter((row) => row.inserted).length;
  return { inserted, updated: returned.length - inserted, failures: [] };
}

/** Row by row inside savepoints, so one bad row costs one row (19 §19.1 batches). */
async function runRows(
  conn: Reserved,
  table: TableSchema,
  rows: RowValues[],
  opts: ImportOptions
): Promise<ImportBatchResult> {
  const result: ImportBatchResult = { inserted: 0, updated: 0, failures: [] };
  for (const [index, row] of rows.entries()) {
    await conn.unsafe("SAVEPOINT import_row");
    try {
      const one = await runBatch(conn, table, [row], opts);
      result.inserted += one.inserted;
      result.updated += one.updated;
      await conn.unsafe("RELEASE SAVEPOINT import_row");
    } catch (cause: unknown) {
      await conn.unsafe("ROLLBACK TO SAVEPOINT import_row");
      result.failures.push({ index, message: translate(cause, "import").message });
    }
  }
  return result;
}

/**
 * One transaction per batch: `replace` empties the table before the first batch with `DELETE FROM`
 * (never TRUNCATE, 19 §19.3); a failed batch is retried row by row so the report names the rows.
 */
export async function importRows(
  sql: SQL,
  ref: TableRef,
  rows: RowValues[],
  opts: ImportOptions,
  schemas?: string[]
): Promise<ImportBatchResult> {
  const live = await introspect(sql, [], schemas);
  const table = live.tables.find((item) => sameTable(item, ref));
  if (table === undefined)
    throw new EngineError("unsupported", `table ${ref.name} not found`, { reason: "table" });
  const conn = await sql.reserve();
  try {
    await conn.unsafe("BEGIN");
    await conn.unsafe("SET LOCAL TIME ZONE 'UTC'");
    if (!opts.foreignKeyChecks) await conn.unsafe("SET CONSTRAINTS ALL DEFERRED");
    if (opts.mode === "replace" && opts.firstBatch)
      await conn.unsafe(`DELETE FROM ONLY ${quoteTable(table.schema, table.name)}`);
    let result: ImportBatchResult;
    await conn.unsafe("SAVEPOINT import_batch");
    try {
      result = await runBatch(conn, table, rows, opts);
      await conn.unsafe("RELEASE SAVEPOINT import_batch");
    } catch {
      await conn.unsafe("ROLLBACK TO SAVEPOINT import_batch");
      result = await runRows(conn, table, rows, opts);
    }
    await conn.unsafe("COMMIT");
    return result;
  } catch (cause: unknown) {
    await swallow(conn.unsafe("ROLLBACK"));
    throw cause instanceof EngineError ? cause : translate(cause, "import");
  } finally {
    conn.release();
  }
}
