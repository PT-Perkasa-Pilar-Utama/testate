import type { SQL } from "bun";
import type { JsonObject, JsonValue, TableSchema } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

import { EngineError, rowText, sameTable } from "../types.ts";
import type {
  ImportBatchResult,
  ImportOptions,
  RowOp,
  RowOpResult,
  RowValues,
  TableRef,
  WriteOptions,
} from "../types.ts";
import { translate } from "./errors.ts";
import { introspect } from "./introspect.ts";
import { quoteIdent } from "./pool.ts";
import { rowJson, swallow } from "./reader.ts";

type Reserved = Awaited<ReturnType<SQL["reserve"]>>;

const returned = v.object({ j: v.string() });

function bind(value: JsonValue): string {
  return v.is(v.string(), value) ? value : JSON.stringify(value);
}

type Bound = { sql: string; params: string[] };
type Assigned = { sql: string[]; params: string[] };
type Counts = { inserted: number; updated: number };

function whereKey(pk: JsonObject): Bound {
  const parts: string[] = [];
  const params: string[] = [];
  for (const [column, value] of Object.entries(pk)) {
    if (value === null) {
      parts.push(`${quoteIdent(column)} IS NULL`);
      continue;
    }
    parts.push(`${quoteIdent(column)} = ?`);
    params.push(bind(value));
  }
  if (parts.length === 0)
    throw new EngineError("unsupported", "a primary key is required", { reason: "pk" });
  return { sql: parts.join(" AND "), params };
}

function assignments(values: RowValues): Assigned {
  const sql: string[] = [];
  const params: string[] = [];
  for (const value of Object.values(values)) {
    if (value.kind === "default") {
      sql.push("DEFAULT");
      continue;
    }
    if (value.value === null) {
      sql.push("NULL");
      continue;
    }
    sql.push("?");
    params.push(bind(value.value));
  }
  return { sql, params };
}

async function readBack(
  conn: Reserved,
  table: TableSchema,
  pk: JsonObject
): Promise<string | null> {
  const key = whereKey(pk);
  const rows = v.parse(v.array(returned), [
    ...(await conn.unsafe(
      `SELECT ${rowJson(table)} AS j FROM ${quoteIdent(table.name)} t WHERE ${key.sql}`,
      key.params
    )),
  ]);
  return rows[0]?.j ?? null;
}

/** The inserted key: given values first, then LAST_INSERT_ID for the auto column, else null. */
function insertedKey(table: TableSchema, values: RowValues, lastId: number): JsonObject {
  const auto = table.columns.find((column) => column.identity)?.name;
  const pk: JsonObject = {};
  for (const column of table.primary_key ?? []) {
    const given = values[column];
    if (given?.kind === "value") pk[column] = given.value;
    else pk[column] = column === auto ? lastId : null;
  }
  return pk;
}

async function insertOp(
  conn: Reserved,
  table: TableSchema,
  op: Extract<RowOp, { kind: "insert" }>
): Promise<RowOpResult> {
  const columns = Object.keys(op.values);
  const bound = assignments(op.values);
  const result = await conn.unsafe(
    `INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(", ")}) VALUES (${bound.sql.join(", ")})`,
    bound.params
  );
  const pk = insertedKey(table, op.values, Number(result.lastInsertRowid ?? 0));
  const json = await readBack(conn, table, pk);
  return { kind: "insert", pk, row: json === null ? null : rowText(json) };
}

function noRow(index: number): EngineError {
  return new EngineError("batch_failed", `edit ${index} matched no row`, {
    failed_index: index,
    engine_message: "no row matched",
  });
}

async function updateOp(
  conn: Reserved,
  table: TableSchema,
  op: Extract<RowOp, { kind: "update" }>,
  index: number
): Promise<RowOpResult> {
  const key = whereKey(op.pk);
  const bound = assignments(op.values);
  const sets = Object.keys(op.values).map(
    (column, position) => `${quoteIdent(column)} = ${bound.sql[position] ?? "DEFAULT"}`
  );
  await conn.unsafe(`UPDATE ${quoteIdent(table.name)} SET ${sets.join(", ")} WHERE ${key.sql}`, [
    ...bound.params,
    ...key.params,
  ]);
  const json = await readBack(conn, table, op.pk);
  if (json === null) throw noRow(index);
  return { kind: "update", pk: op.pk, row: rowText(json) };
}

async function deleteOp(
  conn: Reserved,
  table: TableSchema,
  op: Extract<RowOp, { kind: "delete" }>,
  index: number
): Promise<RowOpResult> {
  const key = whereKey(op.pk);
  const result = await conn.unsafe(
    `DELETE FROM ${quoteIdent(table.name)} WHERE ${key.sql}`,
    key.params
  );
  if ((result.affectedRows ?? 0) === 0) throw noRow(index);
  return { kind: "delete", pk: op.pk, row: null };
}

async function runOp(
  conn: Reserved,
  table: TableSchema,
  op: RowOp,
  index: number
): Promise<RowOpResult> {
  if (op.kind === "insert") return insertOp(conn, table, op);
  if (op.kind === "update") return updateOp(conn, table, op, index);
  return deleteOp(conn, table, op, index);
}

async function tableOf(conn: Pick<SQL, "unsafe">, ref: TableRef): Promise<TableSchema> {
  const live = await introspect(conn, []);
  const table = live.tables.find((item) => sameTable(item, { schema: null, name: ref.name }));
  if (table === undefined)
    throw new EngineError("unsupported", `table ${ref.name} not found`, { reason: "table" });
  return table;
}

/** All ops in one transaction; FK checks off maps to `SET FOREIGN_KEY_CHECKS = 0` for the session (12 §12.3). */
export async function writeRows(
  sql: SQL,
  ref: TableRef,
  ops: RowOp[],
  opts: WriteOptions
): Promise<RowOpResult[]> {
  const table = await tableOf(sql, ref);
  const conn = await sql.reserve();
  try {
    await conn.unsafe(`SET SESSION FOREIGN_KEY_CHECKS = ${opts.foreignKeyChecks ? 1 : 0}`);
    await conn.unsafe("SET SESSION time_zone = '+00:00'");
    await conn.unsafe("START TRANSACTION");
    const results: RowOpResult[] = [];
    for (const [index, op] of ops.entries()) {
      if (opts.signal?.aborted) throw new EngineError("cancelled", "edit cancelled");
      try {
        results.push(await runOp(conn, table, op, index));
      } catch (cause: unknown) {
        const error = translate(cause, `edit ${index}`);
        throw new EngineError(error.kind, error.message, {
          ...error.details,
          failed_index: index,
          engine_message: error.message,
        });
      }
    }
    await conn.unsafe("COMMIT");
    return results;
  } catch (cause: unknown) {
    await swallow(conn.unsafe("ROLLBACK"));
    throw cause instanceof EngineError ? cause : translate(cause, "edit");
  } finally {
    await swallow(conn.unsafe("SET SESSION FOREIGN_KEY_CHECKS = 1"));
    conn.release();
  }
}

function importStatement(table: TableSchema, rows: RowValues[], opts: ImportOptions): Bound {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const params: string[] = [];
  const tuples = rows.map(
    (row) =>
      `(${columns
        .map((column) => {
          const value = row[column];
          if (value === undefined || value.kind === "default") return "DEFAULT";
          if (value.value === null) return "NULL";
          params.push(bind(value.value));
          return "?";
        })
        .join(", ")})`
  );
  const target = quoteIdent(table.name);
  let conflict = "";
  if (opts.mode === "upsert") {
    const updates = columns
      .filter((column) => !opts.keyColumns.includes(column))
      .map((column) => `${quoteIdent(column)} = VALUES(${quoteIdent(column)})`);
    conflict =
      updates.length === 0
        ? ` ON DUPLICATE KEY UPDATE ${quoteIdent(columns[0] ?? "")} = ${quoteIdent(columns[0] ?? "")}`
        : ` ON DUPLICATE KEY UPDATE ${updates.join(", ")}`;
  }
  return {
    sql: `INSERT INTO ${target} (${columns.map(quoteIdent).join(", ")}) VALUES ${tuples.join(", ")}${conflict}`,
    params,
  };
}

/** MySQL reports 1 per insert and 2 per update through ON DUPLICATE KEY (documented affected-rows rule). */
function countOf(affected: number, rows: number, opts: ImportOptions): Counts {
  if (opts.mode !== "upsert") return { inserted: rows, updated: 0 };
  const updated = Math.max(0, affected - rows);
  return { inserted: rows - updated, updated };
}

async function runBatch(
  conn: Reserved,
  table: TableSchema,
  rows: RowValues[],
  opts: ImportOptions
): Promise<ImportBatchResult> {
  const statement = importStatement(table, rows, opts);
  const result = await conn.unsafe(statement.sql, statement.params);
  return {
    ...countOf(Number(result.affectedRows ?? rows.length), rows.length, opts),
    failures: [],
  };
}

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

/** One transaction per batch; `replace` empties with `DELETE FROM` before the first batch (19 §19.3). */
export async function importRows(
  sql: SQL,
  ref: TableRef,
  rows: RowValues[],
  opts: ImportOptions
): Promise<ImportBatchResult> {
  const table = await tableOf(sql, ref);
  const conn = await sql.reserve();
  try {
    await conn.unsafe(`SET SESSION FOREIGN_KEY_CHECKS = ${opts.foreignKeyChecks ? 1 : 0}`);
    await conn.unsafe("SET SESSION time_zone = '+00:00'");
    await conn.unsafe("START TRANSACTION");
    if (opts.mode === "replace" && opts.firstBatch)
      await conn.unsafe(`DELETE FROM ${quoteIdent(table.name)}`);
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
    await swallow(conn.unsafe("SET SESSION FOREIGN_KEY_CHECKS = 1"));
    conn.release();
  }
}

export { jsonObjectSchema };
