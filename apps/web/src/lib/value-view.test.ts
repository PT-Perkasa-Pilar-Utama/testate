import { describe, expect, test } from "bun:test";

import { LONG_TEXT, fullValueOf, needsViewer, oneLine } from "./value-view.ts";

describe("a value too big for its cell", () => {
  test("an object or an array opens in full, laid out as JSON", () => {
    expect(fullValueOf({ a: [1, 2] })).toEqual({ kind: "json", value: { a: [1, 2] } });
    expect(needsViewer([1])).toBe(true);
  });

  test("a string holding a JSON object is shown as that object, not as one escaped line", () => {
    expect(fullValueOf('{"ok":true}')).toEqual({ kind: "json", value: { ok: true } });
    expect(needsViewer('{"ok":true}')).toBe(true);
  });

  test("a string that only looks like JSON stays text", () => {
    expect(fullValueOf("[draft")).toEqual({ kind: "text", text: "[draft" });
  });

  test("a string with a line break opens in full however short it is", () => {
    expect(needsViewer("a\nb")).toBe(true);
  });

  test("a string past the limit opens in full, and one at the limit does not", () => {
    expect(needsViewer("x".repeat(LONG_TEXT + 1))).toBe(true);
    expect(needsViewer("x".repeat(LONG_TEXT))).toBe(false);
  });

  test("a number, a flag, and NULL fit their cell", () => {
    expect(needsViewer(42)).toBe(false);
    expect(needsViewer(true)).toBe(false);
    expect(needsViewer(null)).toBe(false);
    expect(needsViewer(undefined)).toBe(false);
  });
});

describe("a value on one line", () => {
  test("line breaks fold to spaces so a row keeps its height", () => {
    expect(oneLine("first\n  second")).toBe("first second");
  });

  test("an object reads as compact JSON", () => {
    expect(oneLine({ a: 1 })).toBe('{"a":1}');
  });

  test("a missing value reads NULL", () => {
    expect(oneLine(null)).toBe("NULL");
    expect(oneLine(undefined)).toBe("NULL");
  });
});
