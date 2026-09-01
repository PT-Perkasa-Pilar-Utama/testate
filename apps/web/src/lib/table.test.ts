import { describe, expect, test } from "bun:test";

import { activeFilterCount, compareBy, matchesQuery, nextSort, sortRows } from "./table.ts";
import type { SortState } from "./table.ts";

type Row = { name: string; size: number | null; note: string | null };

const ROWS: Row[] = [
  { name: "state 10", size: 200, note: null },
  { name: "state 2", size: null, note: "kept" },
  { name: "Ada", size: 5, note: "first" },
];

const SORTERS = {
  name: { text: (row: Row) => row.name },
  size: { number: (row: Row) => row.size },
} as const;

describe("how a column sorts", () => {
  test("a name orders the way a person reads it, so 2 comes before 10", () => {
    const sorted = sortRows(ROWS, SORTERS, { key: "name", direction: "asc" });
    expect(sorted.map((row) => row.name)).toStrictEqual(["Ada", "state 2", "state 10"]);
  });

  test("a size orders by value, not by the digits in it", () => {
    const sorted = sortRows(ROWS, SORTERS, { key: "size", direction: "asc" });
    expect(sorted.map((row) => row.size)).toStrictEqual([5, 200, null]);
  });

  test("a row with no value sits last both ways round, because it is not a small value", () => {
    const down = sortRows(ROWS, SORTERS, { key: "size", direction: "desc" });
    expect(down.map((row) => row.size)).toStrictEqual([200, 5, null]);
  });

  test("no sort leaves the order the API sent, and leaves the array it sent alone", () => {
    const rows = [...ROWS];
    expect(sortRows(rows, SORTERS, null)).toStrictEqual(ROWS);
    sortRows(rows, SORTERS, { key: "name", direction: "asc" });
    expect(rows).toStrictEqual(ROWS);
  });

  test("two rows that read the same compare equal", () => {
    const row: Row = { name: "state 10", size: 200, note: null };
    expect(compareBy(SORTERS.name, row, { ...row })).toBe(0);
  });
});

describe("clicking a header", () => {
  test("goes up, then down, then back to the order it started in", () => {
    const first = nextSort(null, "name");
    expect(first).toStrictEqual({ key: "name", direction: "asc" });
    expect(nextSort(first, "name")).toStrictEqual({ key: "name", direction: "desc" });
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toBeNull();
  });

  test("a different column starts over rather than inheriting the direction", () => {
    const current: SortState<"name" | "size"> = { key: "name", direction: "desc" };
    expect(nextSort(current, "size")).toStrictEqual({ key: "size", direction: "asc" });
  });
});

describe("what the search box matches", () => {
  test("every word has to appear, so a second word narrows the list", () => {
    expect(matchesQuery(["admin", "qa lead"], "admin qa")).toBe(true);
    expect(matchesQuery(["admin", "qa lead"], "admin viewer")).toBe(false);
  });

  test("case and empty fields do not decide the answer", () => {
    expect(matchesQuery(["Ada", null], "ada")).toBe(true);
    expect(matchesQuery([null, null], "ada")).toBe(false);
  });

  test("an empty box matches every row, including one with nothing in it", () => {
    expect(matchesQuery([null], "   ")).toBe(true);
  });
});

describe("the badge on Filters", () => {
  test("counts each flag as one filter, not each field it took to set", () => {
    expect(activeFilterCount(false, false)).toBe(0);
    // A date range is two boxes (from, to) but the caller passes one flag for the pair.
    expect(activeFilterCount(true)).toBe(1);
    expect(activeFilterCount(true, false, true)).toBe(2);
  });
});
