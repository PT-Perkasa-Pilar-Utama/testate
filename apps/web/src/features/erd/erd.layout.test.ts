import { describe, expect, test } from "bun:test";
import type { TableSchema } from "@testate/shared";
import ELK from "elkjs/lib/elk-api.js";

import {
  COLUMN_CAP,
  HEADER,
  MAX_BOX,
  MIN_BOX,
  ROW,
  keyOf,
  layout,
  neighbours,
  sizeOf,
} from "./erd.layout.ts";
import type { Box, Diagram, Measure } from "./erd.layout.ts";

/** Seven pixels a character: close enough to Mona Sans at 11px for widths to mean something. */
const measure: Measure = (text) => text.length * 7;
// The browser runs ELK in a worker, and so does this test: Bun has `self`, so the bundled build's
// in-process fallback never switches on.
const engine = new ELK({
  workerFactory: () => new Worker(Bun.resolveSync("elkjs/lib/elk-worker.min.js", import.meta.dir)),
});

const column = (name: string, extra: Partial<TableSchema["columns"][number]> = {}) => ({
  name,
  type: "text",
  nullable: true,
  has_default: false,
  generated: false,
  identity: false,
  policy: null,
  ...extra,
});

const table = (
  name: string,
  refs: string[] = [],
  extra: TableSchema["columns"] = []
): TableSchema => ({
  schema: "public",
  name,
  kind: "table",
  row_estimate: 0,
  columns: [column("id"), ...refs.map((ref) => column(`${ref}_id`)), ...extra],
  primary_key: ["id"],
  foreign_keys_out: refs.map((ref) => ({
    columns: [`${ref}_id`],
    ref: { schema: "public", name: ref },
    ref_columns: ["id"],
    deferrable: false,
  })),
  foreign_keys_in: [],
  unique: [],
  unsupported: [],
  excluded: false,
  display_column: null,
});

/** The box the layout should have produced, or a failure naming the one it did not. */
function boxAt(drawn: Diagram, key: string): Box {
  const found = drawn.boxes.find((box) => box.key === key);
  if (found === undefined) throw new Error(`no box for ${key}`);
  return found;
}

/** A drawn column of a box, or a failure naming the one that is missing. */
function columnOf(box: Pick<Box, "columns">, name: string): Box["columns"][number] {
  const found = box.columns.find((one) => one.name === name);
  if (found === undefined) throw new Error(`no column ${name}`);
  return found;
}

/** Where a column's row meets its box, the way the layout puts a port. */
function rowY(box: Box, name: string): number {
  return box.y + HEADER + 9 + box.columns.findIndex((one) => one.name === name) * ROW;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("laying a schema out", () => {
  test("a foreign key runs from its own column to the column it references", async () => {
    const drawn = await layout(
      [table("customers"), table("orders", ["customers"])],
      measure,
      engine
    );
    const orders = boxAt(drawn, "public.orders");
    const customers = boxAt(drawn, "public.customers");
    const edge = drawn.edges[0];
    const start = edge?.points[0];
    const end = edge?.points.at(-1);
    expect(edge?.label).toBe("customers_id");
    expect(start).toEqual({ x: orders.x + orders.width, y: rowY(orders, "customers_id") });
    expect(end).toEqual({ x: customers.x, y: rowY(customers, "id") });
  });

  test("a referenced table sits to the right of the table that points at it", async () => {
    const drawn = await layout(
      [table("lines", ["orders"]), table("orders", ["customers"]), table("customers")],
      measure,
      engine
    );
    expect(boxAt(drawn, "public.orders").x).toBeGreaterThan(boxAt(drawn, "public.lines").x);
    expect(boxAt(drawn, "public.customers").x).toBeGreaterThan(boxAt(drawn, "public.orders").x);
  });

  test("no two boxes overlap, and the canvas covers every one", async () => {
    const tables = [
      table("a"),
      table("b", ["a"]),
      table("c", ["a"]),
      table("d", ["b", "c"]),
      table("e"),
      table("f", ["e", "a"]),
    ];
    const drawn = await layout(tables, measure, engine);
    const pairs = drawn.boxes.flatMap((a, i) =>
      drawn.boxes.slice(i + 1).map((b) => [a, b] as const)
    );
    expect(pairs.filter(([a, b]) => overlaps(a, b)).map(([a, b]) => `${a.key}/${b.key}`)).toEqual(
      []
    );
    expect(Math.max(...drawn.boxes.map((box) => box.x + box.width))).toBeLessThanOrEqual(
      drawn.width
    );
    expect(Math.max(...drawn.boxes.map((box) => box.y + box.height))).toBeLessThanOrEqual(
      drawn.height
    );
  });

  test("a cycle and a self-reference lay out instead of hanging", async () => {
    const drawn = await layout(
      [table("a", ["b"]), table("b", ["a"]), table("tree", ["tree"])],
      measure,
      engine
    );
    expect(drawn.boxes.map((box) => box.key).sort()).toEqual([
      "public.a",
      "public.b",
      "public.tree",
    ]);
    expect(drawn.edges.length).toBe(3);
  });

  test("a foreign key pointing outside the drawn set is not an edge to nowhere", async () => {
    const drawn = await layout([table("orders", ["customers"])], measure, engine);
    expect(drawn.edges).toEqual([]);
    expect(drawn.boxes.map((box) => box.key)).toEqual(["public.orders"]);
  });
});

describe("sizing a box", () => {
  test("a box is as wide as its widest line, and never narrower than the minimum", () => {
    expect(sizeOf(table("t"), measure).width).toBe(MIN_BOX);
    const wide = sizeOf(table("t", [], [column("created_at", { type: "timestamp" })]), measure);
    expect(wide.width).toBeGreaterThanOrEqual(14 + 10 * 7 + 16 + 11 * 7 + 20);
  });

  test("a type too long for the widest box is cut, not drawn over its column name", () => {
    const long = column("ttl_expires_at", { type: "timestamp with time zone ".repeat(3).trim() });
    const box = sizeOf(table("t", [], [long]), measure);
    const shownType = columnOf(box, "ttl_expires_at").shownType;
    expect(box.width).toBe(MAX_BOX);
    expect(shownType.endsWith("…")).toBe(true);
    expect(
      14 + measure("ttl_expires_at", "name") + 16 + measure(shownType, "type")
    ).toBeLessThanOrEqual(MAX_BOX - 20);
  });

  test("a wide table keeps its keys and counts what it dropped", () => {
    const fillers = Array.from({ length: COLUMN_CAP + 5 }, (_unused, index) =>
      column(`filler_${index}`)
    );
    const box = sizeOf(table("wide", ["owner"], fillers), measure);
    expect(box.columns.length).toBe(COLUMN_CAP);
    // id and owner_id plus COLUMN_CAP + 5 fillers is COLUMN_CAP + 7 columns in all.
    expect(box.hidden).toBe(7);
    expect(box.columns.map((one) => one.name).slice(0, 2)).toEqual(["id", "owner_id"]);
  });
});

describe("starting from one table", () => {
  test("focusing a table draws it and one hop, not the whole schema", () => {
    const orders = table("orders", ["customers"]);
    orders.foreign_keys_in = [{ from: { schema: "public", name: "lines" }, columns: ["order_id"] }];
    const near = neighbours(
      [orders, table("customers"), table("lines", ["orders"]), table("far")],
      "public.orders"
    );
    expect(near.map(keyOf).sort()).toEqual(["public.customers", "public.lines", "public.orders"]);
  });
});
