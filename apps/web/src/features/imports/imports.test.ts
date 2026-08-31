import { describe, expect, test } from "bun:test";
import { importModeSchema } from "@testate/shared";
import type { TableSchema } from "@testate/shared";

import {
  MODE_OPTIONS,
  TRANSFORMS,
  TRANSFORM_OPTIONS,
  blockedReason,
  commitButtonLabel,
  commitPrompt,
  defaultMappingName,
  guessColumns,
  mappingBody,
  reportCounts,
  reportSummary,
  runBody,
  sourceBody,
} from "./imports.helpers.ts";

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

  test("every wire mode and transform has a plain-English label, so none can drift unlabelled (defects 1, 2)", () => {
    expect(MODE_OPTIONS.map((option) => option.value)).toStrictEqual([...importModeSchema.options]);
    expect(TRANSFORM_OPTIONS.map((option) => option.value)).toStrictEqual([...TRANSFORMS]);
  });

  test("a mapping defaults to the table's own name, schema-qualified or not (defect 3)", () => {
    expect(defaultMappingName("public.customers")).toBe("customers");
    expect(defaultMappingName("customers")).toBe("customers");
  });

  test("the primary action says why it is blocked, next to itself, only for upsert without keys (defect 4)", () => {
    const draft = { ...DRAFT, mode: "append" as const, key_columns: "" };
    expect(blockedReason(draft, false)).toBe("Load a file first.");
    expect(blockedReason({ ...draft, table: "" }, true)).toBe("Choose a table to import into.");
    expect(blockedReason(draft, true)).toBeNull();
    const noKeys = { ...draft, mode: "upsert" as const };
    expect(blockedReason(noKeys, true)).toBe(
      "Pick at least one key column below to match rows by."
    );
    expect(blockedReason({ ...noKeys, key_columns: "email" }, true)).toBeNull();
  });

  test("the report states a fact and the commit step asks a real question beside real numbers (defect 5)", () => {
    const preview = reportCounts({
      dry_run: true,
      inserted: 0,
      updated: 0,
      skipped: 1204,
      failed: 2,
    });
    expect(reportSummary(preview, true)).toBe("1,204 rows ready. 2 rows will be rejected.");
    expect(commitPrompt(preview)).toBe("2 rows will be rejected. Import the other 1,204?");

    const clean = reportCounts({ dry_run: true, inserted: 0, updated: 0, skipped: 5, failed: 0 });
    expect(reportSummary(clean, true)).toBe("All 5 rows look ready to import.");
    expect(commitPrompt(clean)).toBe("All 5 rows are ready. Import them?");

    const singular = reportCounts({
      dry_run: true,
      inserted: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(commitPrompt(singular)).toBe("All 1 row is ready. Import it?");
    expect(commitButtonLabel(1)).toBe("Import 1 row");
    expect(commitButtonLabel(1204)).toBe("Import 1,204 rows");

    const allRejected = reportCounts({
      dry_run: true,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 3,
    });
    expect(commitPrompt(allRejected)).toBe(
      "Every row will be rejected. Fix the file and try again."
    );

    const done = reportCounts({ dry_run: false, inserted: 10, updated: 2, skipped: 0, failed: 1 });
    expect(reportSummary(done, false)).toBe("Imported 12 rows. 1 row was rejected.");
  });
});
