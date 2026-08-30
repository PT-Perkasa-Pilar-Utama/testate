import { describe, expect, test } from "bun:test";

import { describeProgress } from "./jobs.presenter.ts";

describe("describeProgress", () => {
  test("reads as a sentence and never shows an id", () => {
    expect(
      describeProgress({
        phase: "snapshot",
        adapter_id: "01a050c7-06f4-74d5-ad69-df3001192701",
        adapters_done: 3,
        tables_done: 3,
        table: "orders",
      })
    ).toBe("Snapshotting orders, 3 tables");
  });

  test("counts what the phase is counting", () => {
    expect(describeProgress({ phase: "restore", tables_done: 12, tables_total: 42 })).toBe(
      "Restoring, 12 of 42 tables"
    );
    expect(describeProgress({ phase: "write", rows: 500, total: 1200 })).toBe(
      "Writing rows, 500 of 1200 rows"
    );
    expect(describeProgress({ phase: "merge", done: 2, total: 4 })).toBe(
      "Comparing, 2 of 4 adapters"
    );
  });

  test("names the hook it is running", () => {
    expect(describeProgress({ phase: "hooks", trigger: "before_checkout" })).toBe(
      "Running the before_checkout hooks"
    );
  });

  test("says nothing when there is nothing to say", () => {
    expect(describeProgress(null)).toBe("");
    expect(describeProgress({ phase: "stash" })).toBe("Stashing the live data");
  });
});
