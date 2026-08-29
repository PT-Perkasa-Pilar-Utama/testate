import { describe, expect, test } from "bun:test";
import type { DiffRow, JsonObject } from "@testate/shared";

import { rowText } from "../engines/types.ts";
import type { EncodedRow } from "../engines/types.ts";
import { compareKeys, mergeRows } from "./merge.ts";

function pk(id: number, body: JsonObject): EncodedRow {
  return {
    key: { by: "primary-key", value: [id] },
    json: rowText(JSON.stringify({ id, ...body })),
  };
}

async function* stream(rows: EncodedRow[]): AsyncIterable<EncodedRow> {
  yield* rows;
}

async function drain(
  base: EncodedRow[],
  target: EncodedRow[]
): Promise<{ rows: DiffRow[]; stats: { added: number; removed: number; changed: number } }> {
  const stats = { added: 0, removed: 0, changed: 0 };
  const rows: DiffRow[] = [];
  for await (const row of mergeRows(stream(base), stream(target), stats)) rows.push(row);
  return { rows, stats };
}

describe("mergeRows", () => {
  test("yields removed, added, and changed rows in key order with the changed columns", async () => {
    const { rows, stats } = await drain(
      [pk(1, { status: "pending" }), pk(2, { status: "paid" }), pk(4, { status: "x" })],
      [pk(1, { status: "paid" }), pk(3, { status: "new" }), pk(4, { status: "x" })]
    );
    expect(rows.map((row) => `${row.op}:${String(row.k)}`)).toEqual([
      "changed:1",
      "removed:2",
      "added:3",
    ]);
    expect(rows[0]?.changed_columns).toEqual(["status"]);
    expect(stats).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  test("a column present on one side only counts as changed", async () => {
    const { rows } = await drain([pk(1, { a: 1 })], [pk(1, { a: 1, b: 2 })]);
    expect(rows[0]?.changed_columns).toEqual(["b"]);
  });

  test("keys compare numerically for numbers and by code point for strings", () => {
    expect(compareKeys({ by: "primary-key", value: [9] }, { by: "primary-key", value: [10] })).toBe(
      -1
    );
    expect(
      compareKeys({ by: "primary-key", value: ["9"] }, { by: "primary-key", value: ["10"] })
    ).toBe(1);
    expect(compareKeys({ by: "row-hash", value: "a" }, { by: "row-hash", value: "a" })).toBe(0);
  });
});
