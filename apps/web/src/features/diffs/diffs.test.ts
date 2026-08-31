import { describe, expect, test } from "bun:test";

import {
  changedRows,
  diffTotals,
  hiddenCount,
  keyLabel,
  tableLabel,
  tablesToShow,
  toCreateBody,
  touched,
} from "./diffs.presenter.ts";
import type { DiffAdapter, DiffTable } from "./diffs.presenter.ts";
import type { Diff } from "@testate/shared";

describe("diffs feature", () => {
  test("changed rows counts added, removed and changed across every adapter and table", () => {
    const table = (
      added: number,
      removed: number,
      changed: number
    ): Diff["adapters"][0]["tables"][0] => ({
      schema: "public",
      name: "orders",
      compare: "primary-key",
      added,
      removed,
      changed,
      unchanged: false,
      schema_changed: null,
    });
    const diff: Pick<Diff, "adapters"> = {
      adapters: [
        {
          adapter_id: "a1",
          name: "shop",
          compared: true,
          tables: [table(2, 1, 3), table(0, 0, 5)],
        },
        { adapter_id: "a2", name: "warehouse", compared: true, tables: [table(1, 0, 0)] },
      ],
    };

    expect(changedRows(diff)).toBe(12);
  });

  test("the create body targets a state or the literal live (stories 88, 89)", () => {
    expect(toCreateBody({ base_state_id: "s1", target: "live" })).toStrictEqual({
      base_state_id: "s1",
      target: "live",
    });
    expect(toCreateBody({ base_state_id: "s1", target: "s2" })).toStrictEqual({
      base_state_id: "s1",
      target: { state_id: "s2" },
    });
  });

  test("row keys render as text for primary keys and row hashes (story 92)", () => {
    expect(keyLabel({ k: [42, "a"], op: "added", before: null, after: {} })).toBe('42, "a"');
    expect(keyLabel({ k: "h:abc", op: "removed", before: {}, after: null })).toBe("h:abc");
  });

  describe("the detail dialog's summary", () => {
    const table = (
      name: string,
      added: number,
      schemaChanged: string[] | null = null
    ): DiffTable => ({
      schema: null,
      name,
      compare: "primary-key",
      added,
      removed: 0,
      changed: 0,
      unchanged: added === 0,
      schema_changed: schemaChanged,
    });
    const adapter = (tables: DiffTable[]): DiffAdapter => ({
      adapter_id: "a1",
      name: "shop",
      compared: true,
      tables,
    });

    test("a table counts as touched when rows moved or when its schema did", () => {
      expect(touched(table("orders", 2))).toBe(true);
      expect(touched(table("quiet", 0))).toBe(false);
      expect(touched(table("quiet", 0, ["added column note"]))).toBe(true);
    });

    test("totals add up across every adapter and count only the touched tables", () => {
      const totals = diffTotals({
        adapters: [adapter([table("orders", 2), table("quiet", 0)]), adapter([table("notes", 3)])],
      });
      expect(totals).toStrictEqual({ added: 5, removed: 0, changed: 0, tables: 2 });
    });

    test("unchanged tables are hidden until asked for, and the count says how many", () => {
      const one = adapter([table("orders", 2), table("quiet", 0), table("still", 0)]);
      expect(tablesToShow(one, false, "").map((t) => t.name)).toStrictEqual(["orders"]);
      expect(tablesToShow(one, true, "").map((t) => t.name)).toStrictEqual([
        "orders",
        "quiet",
        "still",
      ]);
      expect(hiddenCount({ adapters: [one] })).toBe(2);
    });

    test("the filter matches the qualified name and holds the unchanged rule", () => {
      const one = adapter([table("orders", 2), table("order_items", 4), table("quiet", 0)]);
      expect(tablesToShow(one, false, "order").map((t) => t.name)).toStrictEqual([
        "orders",
        "order_items",
      ]);
      expect(tablesToShow(one, false, "ITEMS").map((t) => t.name)).toStrictEqual(["order_items"]);
      expect(tablesToShow(one, false, "quiet")).toStrictEqual([]);
      expect(tablesToShow(one, true, "quiet").map((t) => t.name)).toStrictEqual(["quiet"]);
    });

    test("a table label carries its schema when it has one", () => {
      expect(tableLabel(table("orders", 0))).toBe("orders");
      expect(tableLabel({ ...table("customers", 0), schema: "contract" })).toBe(
        "contract.customers"
      );
    });
  });
});
