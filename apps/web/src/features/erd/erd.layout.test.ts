import { describe, expect, test } from "bun:test";
import type { TableSchema } from "@testate/shared";

import { COLUMN_CAP, keyOf, layersOf, layout, neighbours } from "./erd.layout.ts";
import type { Box } from "./erd.layout.ts";

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
  columns = [column("id")],
  primaryKey: string[] | null = ["id"]
): TableSchema => ({
  schema: "public",
  name,
  kind: "table",
  row_estimate: 0,
  columns,
  primary_key: primaryKey,
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
function boxAt(drawn: ReturnType<typeof layout>, key: string): Box {
  const found = drawn.boxes.find((box) => box.key === key);
  if (found === undefined) throw new Error(`no box for ${key}`);
  return found;
}

describe("laying a schema out left to right", () => {
  test("a table sits one past the deepest table it points at", () => {
    const layers = layersOf([
      table("customers"),
      table("orders", ["customers"]),
      table("lines", ["orders"]),
    ]);
    expect(layers.get("public.customers")).toBe(0);
    expect(layers.get("public.orders")).toBe(1);
    expect(layers.get("public.lines")).toBe(2);
  });

  test("a cycle settles instead of hanging, and a self-reference stays where it is", () => {
    // Two tables that point at each other have no honest depth; the layout has to answer anyway.
    const layers = layersOf([table("a", ["b"]), table("b", ["a"]), table("tree", ["tree"])]);
    expect(layers.get("public.tree")).toBe(0);
    expect(Number.isFinite(layers.get("public.a"))).toBe(true);
    expect(Number.isFinite(layers.get("public.b"))).toBe(true);
  });

  test("a foreign key pointing outside the drawn set is not an edge to nowhere", () => {
    const drawn = layout([table("orders", ["customers"])]);
    expect(drawn.edges).toEqual([]);
    expect(drawn.boxes.map((box) => box.key)).toEqual(["public.orders"]);
  });

  test("boxes in a layer stack without overlapping, and the canvas covers them", () => {
    const drawn = layout([table("a"), table("b"), table("c", ["a"])]);
    const first = boxAt(drawn, "public.a");
    const second = boxAt(drawn, "public.b");
    expect(first.x).toBe(second.x);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(drawn.width).toBeGreaterThan(first.width);
    expect(drawn.height).toBeGreaterThanOrEqual(second.y + second.height);
  });

  test("a wide table keeps its keys and counts what it dropped", () => {
    const many = [
      column("id"),
      column("owner_id"),
      ...Array.from({ length: COLUMN_CAP + 5 }, (_unused, index) => column(`filler_${index}`)),
    ];
    const drawn = layout([table("wide", ["owner"], many), table("owner")]);
    const box = boxAt(drawn, "public.wide");
    expect(box.columns.length).toBe(COLUMN_CAP);
    // id and owner_id plus COLUMN_CAP + 5 fillers is COLUMN_CAP + 7 columns in all.
    expect(box.hidden).toBe(7);
    expect(box.columns.map((one) => one.name).slice(0, 2)).toEqual(["id", "owner_id"]);
  });

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
