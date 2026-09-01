import { describe, expect, test } from "bun:test";
import { importModeSchema } from "@testate/shared";

import {
  MODE_OPTIONS,
  blockedReason,
  defaultMappingName,
  reportCounts,
  reportSummary,
  runBody,
  sourceBody,
} from "./imports.helpers.ts";

const DRAFT = {
  table: "public.customers",
  mode: "upsert" as const,
  key_columns: "Email, ",
  sheet: "",
};

describe("imports feature", () => {
  test("the run body carries the mode, the source and the stash rule (stories 55, 57)", () => {
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

  test("every wire mode has a plain-English label, so none can drift unlabelled (defect 1)", () => {
    expect(MODE_OPTIONS.map((option) => option.value)).toStrictEqual([...importModeSchema.options]);
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

  test("the report states a fact about what a run found or did (defect 5)", () => {
    const preview = reportCounts({
      dry_run: true,
      inserted: 0,
      updated: 0,
      skipped: 1204,
      failed: 2,
    });
    expect(reportSummary(preview, true)).toBe("1,204 rows ready. 2 rows will be rejected.");

    const clean = reportCounts({ dry_run: true, inserted: 0, updated: 0, skipped: 5, failed: 0 });
    expect(reportSummary(clean, true)).toBe("All 5 rows look ready to import.");

    const done = reportCounts({ dry_run: false, inserted: 10, updated: 2, skipped: 0, failed: 1 });
    expect(reportSummary(done, false)).toBe("Imported 12 rows. 1 row was rejected.");
  });
});
