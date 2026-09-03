import { describe, expect, test } from "bun:test";
import type { ManifestTable } from "@testate/shared";

import { changesAgainst } from "./states.rows.ts";

const table = (name: string, hash: string): ManifestTable => ({
  schema: null,
  name,
  rows: 1,
  bytes: 10,
  blob_hash: hash,
  sort: "primary-key",
  warnings: [],
});

describe("a state's tables against its parent", () => {
  test("same blob is the same, another blob is a change, no counterpart is an addition", () => {
    const { tables, removed_tables } = changesAgainst(
      [table("orders", "h2"), table("customers", "h1"), table("notes", "h9")],
      [table("orders", "h1"), table("customers", "h1"), table("archive", "h5")]
    );
    expect(tables.map((t) => `${t.name}:${t.change}`)).toEqual([
      "orders:changed",
      "customers:same",
      "notes:added",
    ]);
    expect(removed_tables).toEqual(["archive"]);
  });

  test("a root state compares with nothing, and a parent without the adapter makes every table new", () => {
    expect(changesAgainst([table("a", "h")], null).tables[0]?.change).toBeNull();
    expect(changesAgainst([table("a", "h")], []).tables[0]?.change).toBe("added");
  });
});
