import { describe, expect, test } from "bun:test";

import { pretty, unified } from "./diff.text.ts";

describe("comparing one value", () => {
  test("JSON is laid out over lines, and a string holding JSON is too", () => {
    expect(pretty({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(pretty('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(pretty("plain")).toBe("plain");
    expect(pretty(null)).toBe("NULL");
  });

  test("a string that only looks like JSON stays as it was written", () => {
    expect(pretty("[not json after all")).toBe("[not json after all");
  });

  test("the lines both sides share are shown once, and only the middle is marked", () => {
    const lines = unified(
      { id: 1, status: "paid", total: 42 },
      { id: 1, status: "failed", total: 42 }
    );
    expect(lines.filter((line) => line.side === "before").map((line) => line.text.trim())).toEqual([
      '"status": "paid",',
    ]);
    expect(lines.filter((line) => line.side === "after").map((line) => line.text.trim())).toEqual([
      '"status": "failed",',
    ]);
    // The unchanged braces and fields are not repeated once per side.
    expect(lines.filter((line) => line.side === "same").length).toBe(4);
  });

  test("a value replaced outright marks every line, with nothing shared", () => {
    const lines = unified("before", "after");
    expect(lines.map((line) => line.side)).toEqual(["before", "after"]);
  });
});
