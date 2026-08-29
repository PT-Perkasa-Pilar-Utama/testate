import { describe, expect, test } from "bun:test";
import type { TableSchema } from "@testate/shared";

import { guessColumns, mappingBody, runBody, sourceBody } from "./imports.helpers.ts";

const column = (
  name: string,
  extra: Partial<TableSchema["columns"][number]> = {}
): TableSchema["columns"][number] => ({
  name,
  type: "text",
  nullable: true,
  has_default: false,
  generated: false,
  identity: false,
  policy: null,
  ...extra,
});
const TABLE: TableSchema = {
  schema: "public",
  name: "customers",
  kind: "table",
  row_estimate: 2,
  columns: [column("id", { identity: true }), column("Email"), column("balance")],
  primary_key: ["id"],
  foreign_keys_out: [],
  foreign_keys_in: [],
  unique: [],
  unsupported: [],
  excluded: false,
  display_column: null,
};
const DRAFT = {
  name: " weekly ",
  table: "public.customers",
  columns: [
    { target: "Email", source: "email", transform: "trim" as const },
    { target: "balance", source: "", transform: "" as const },
  ],
  mode: "upsert" as const,
  key_columns: "Email, ",
  sheet: "",
};

describe("imports feature", () => {
  test("file columns match table columns by name; identity columns stay out (story 52)", () => {
    expect(guessColumns(["email", "extra"], TABLE)).toStrictEqual([
      { target: "Email", source: "email", transform: "" },
      { target: "balance", source: "", transform: "" },
    ]);
  });

  test("the mapping and run bodies carry transforms, keys, mode, and the stash rule (stories 53, 55, 57)", () => {
    expect(mappingBody(DRAFT)).toStrictEqual({
      name: "weekly",
      target: "public.customers",
      columns: [
        { source: "email", target: "Email", transforms: [{ kind: "trim" }] },
        { source: null, target: "balance", transforms: [] },
      ],
      key_columns: ["Email"],
      mode: "upsert",
    });
    expect(runBody("a1", "m1", { kind: "upload", upload_id: "u1" }, DRAFT, true)).toStrictEqual({
      adapter_id: "a1",
      mapping_id: "m1",
      source: { upload_id: "u1" },
      mode: "upsert",
      dry_run: true,
      stash_first: false,
    });
    expect(
      runBody("a1", "m1", { kind: "rejected", run_id: "r1" }, DRAFT, false)["stash_first"]
    ).toBe(true);
    expect(sourceBody({ kind: "storage", adapter_id: "s1", path: "/in.csv" })).toStrictEqual({
      adapter_id: "s1",
      path: "/in.csv",
    });
  });
});
