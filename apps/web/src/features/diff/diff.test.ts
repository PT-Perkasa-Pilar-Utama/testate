import { describe, expect, test } from "bun:test";
import type { Diff, DiffTable } from "@testate/shared";

import { moved, wantedTarget } from "./diff.presenter.ts";

const table = (name: string, changed: number, schema: string[] | null = null): DiffTable => ({
  schema: null,
  name,
  compare: "primary-key",
  added: 0,
  removed: 0,
  changed,
  unchanged: changed === 0 && schema === null,
  schema_changed: schema,
});

const diff: Diff = {
  id: "d",
  status: "ready",
  base: { id: "a", name: "a" },
  target: { id: "b", name: "b" },
  expires_at: "2026-09-03T00:00:00.000Z",
  created_at: "2026-09-03T00:00:00.000Z",
  adapters: [
    {
      adapter_id: "pg",
      name: "shop-postgres",
      engine: "postgres",
      compared: true,
      tables: [table("customers", 0), table("orders", 2)],
    },
    {
      adapter_id: "mg",
      name: "shop-mongo",
      engine: "mongodb",
      compared: true,
      tables: [table("orders", 0, ["collection added"])],
    },
  ],
};

describe("the diff page's landing table", () => {
  test("a table moved when rows did or its shape did", () => {
    expect(moved(table("t", 0))).toBe(false);
    expect(moved(table("t", 1))).toBe(true);
    expect(moved(table("t", 0, ["table added"]))).toBe(true);
  });

  test("the address names the table to land on; without one, the first that moved", () => {
    expect(wantedTarget(diff, "")?.table.name).toBe("orders");
    expect(wantedTarget(diff, "?adapter=mg")?.adapter_name).toBe("shop-mongo");
    expect(wantedTarget(diff, "?adapter=pg&table=customers")?.table.name).toBe("customers");
    expect(wantedTarget(diff, "?adapter=pg&table=nothing")).toBeNull();
  });
});
