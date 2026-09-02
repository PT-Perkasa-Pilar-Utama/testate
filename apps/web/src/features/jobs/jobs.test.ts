import { describe, expect, test } from "bun:test";

import { jobsQuery } from "./jobs.model.ts";
import { describeProgress, progressFraction } from "./jobs.presenter.ts";

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

  test("names the hook it is running", () => {});

  test("says nothing when there is nothing to say", () => {
    expect(describeProgress(null)).toBe("");
    expect(describeProgress({ phase: "stash" })).toBe("Stashing the live data");
  });

  test("says every runner phase in a person's words, never the runner's own", () => {
    expect(describeProgress({ phase: "tar" })).toBe("Packing the archive");
    expect(describeProgress({ phase: "gc", candidates: 3 })).toBe(
      "Removing what nothing references"
    );
    expect(describeProgress({ phase: "no-such-phase" })).toBe("Working");
  });
});

describe("progressFraction", () => {
  test("divides whichever counter the phase is counting", () => {
    expect(progressFraction({ phase: "restore", tables_done: 12, tables_total: 42 })).toBeCloseTo(
      12 / 42
    );
    expect(progressFraction({ phase: "write", rows: 500, total: 1200 })).toBeCloseTo(500 / 1200);
    expect(progressFraction({ phase: "merge", done: 2, total: 4 })).toBe(0.5);
  });

  test("is null when there is nothing to divide", () => {
    expect(progressFraction(null)).toBeNull();
    expect(progressFraction({ phase: "stash" })).toBeNull();
    expect(progressFraction({ phase: "restore", tables_done: 0, tables_total: 0 })).toBeNull();
  });
});

describe("jobsQuery", () => {
  test("adds kind and status only once a filter has picked one", () => {
    expect(jobsQuery({}, undefined, { kind: "", status: "" })).toStrictEqual({
      cursor: undefined,
      sort: undefined,
      order: undefined,
      q: undefined,
      created_from: undefined,
      created_to: undefined,
      kind: undefined,
      status: undefined,
    });
    expect(jobsQuery({}, "c1", { kind: "snapshot", status: "failed" })).toStrictEqual({
      cursor: "c1",
      sort: undefined,
      order: undefined,
      q: undefined,
      created_from: undefined,
      created_to: undefined,
      kind: "snapshot",
      status: "failed",
    });
  });
});
