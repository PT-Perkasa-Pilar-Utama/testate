import { describe, expect, it } from "bun:test";
import fc from "fast-check";

import { normalizePath } from "./files/index.ts";
import { csvLine, exportCell } from "./csv.ts";
import { parseCsv } from "../modules/imports/imports.csv.ts";

/**
 * Property tests: the parsers and writers that face user bytes, driven by generated input
 * rather than the handful of cases a person thinks of. fast-check shrinks a failure to the
 * smallest input that still fails, which is the input to add to the example tests beside this.
 */
const cell = fc.string({ maxLength: 12 });
// A record with no content at all is a blank line, and the reader skips those on purpose.
const record = fc
  .array(cell, { minLength: 1, maxLength: 5 })
  .filter((cells) => cells.some((value) => value !== ""));
const rows = fc.array(record, { minLength: 1, maxLength: 5 });

describe("csv, under generated input", () => {
  it("reads back exactly what it wrote, whatever the cells hold", () => {
    fc.assert(
      fc.property(rows, (table) => {
        const text = table.map(csvLine).join("\n");
        expect(parseCsv(text, ",")).toStrictEqual(table);
      })
    );
  });

  it("never lets an export cell start as a formula", () => {
    fc.assert(
      fc.property(cell, (value) => {
        const written = exportCell(value).replace(/^"/, "");
        expect(written).not.toMatch(/^(?:[=+@\t\r]|-(?![0-9.]))/);
      })
    );
  });
});

describe("storage paths, under generated input", () => {
  const segment = fc
    .string({ minLength: 1, maxLength: 8 })
    .filter((s) => !s.includes("/") && s !== "." && s !== "..");
  // At least one real segment, so the clean path is never empty and every check below is total.
  const loose = fc
    .tuple(
      segment,
      fc.array(fc.oneof(segment, fc.constant(""), fc.constant(".")), { maxLength: 5 })
    )
    .map(([first, rest]) => [first, ...rest].join("/"));

  it("refuses every path with a parent segment", () => {
    const withParent = fc
      .tuple(fc.array(segment, { maxLength: 3 }), fc.array(segment, { maxLength: 3 }))
      .map(([head, tail]) => [...head, "..", ...tail].join("/"));
    fc.assert(
      fc.property(withParent, (path) => {
        expect(() => normalizePath(path)).toThrow("path may not contain ..");
      })
    );
  });

  it("keeps a path relative and free of empty segments", () => {
    fc.assert(
      fc.property(loose, (path) => {
        const parts = normalizePath(path).split("/");
        expect(parts).not.toContain("");
        expect(parts).not.toContain(".");
      })
    );
  });
});
