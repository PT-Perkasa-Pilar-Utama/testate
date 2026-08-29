import type { JsonObject, TableRef } from "@testate/shared";

import { EngineError, rowText, tableKey } from "../types.ts";
import type { RowOp, RowOpResult } from "../types.ts";
import type { FakeDatabase } from "./engine.ts";

function valuesOf(op: Exclude<RowOp, { kind: "delete" }>, nextId: number): JsonObject {
  const values: JsonObject = {};
  for (const [column, value] of Object.entries(op.values)) {
    values[column] = value.kind === "default" ? nextId : value.value;
  }
  return values;
}

/** Map-backed edits: inserts get the next id, updates and deletes match on `id`; a miss throws. */
export function fakeWriteRows(
  database: FakeDatabase,
  table: TableRef,
  ops: RowOp[]
): Promise<RowOpResult[]> {
  const key = tableKey(table);
  const rows = [...(database.get(key) ?? [])];
  const results: RowOpResult[] = [];
  for (const [index, op] of ops.entries()) {
    if (op.kind === "insert") {
      const row = { id: rows.length + 1, ...valuesOf(op, rows.length + 1) };
      rows.push(row);
      results.push({ kind: "insert", pk: { id: row.id }, row: rowText(JSON.stringify(row)) });
      continue;
    }
    const position = rows.findIndex((row) => String(row["id"]) === String(op.pk["id"]));
    if (position === -1) {
      throw new EngineError("batch_failed", `edit ${index} matched no row`, {
        failed_index: index,
      });
    }
    if (op.kind === "delete") {
      rows.splice(position, 1);
      results.push({ kind: "delete", pk: op.pk, row: null });
      continue;
    }
    const updated = { ...rows[position], ...valuesOf(op, rows.length + 1) };
    rows[position] = updated;
    results.push({ kind: "update", pk: op.pk, row: rowText(JSON.stringify(updated)) });
  }
  database.set(key, rows);
  return Promise.resolve(results);
}
