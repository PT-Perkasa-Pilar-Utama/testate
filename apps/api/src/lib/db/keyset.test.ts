import { describe, expect, it } from "bun:test";

import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from "./keyset.ts";

const KEYSET = {
  column: "p.name COLLATE NOCASE",
  id: "p.id",
  order: "asc",
  idOrder: "asc",
} as const;

describe("keyset cursors", () => {
  it("round-trips a key and refuses garbage", () => {
    expect(decodeCursor(encodeCursor(["b", "id-2"]))).toStrictEqual(["b", "id-2"]);
    expect(() => decodeCursor("not-base64-json")).toThrow("invalid cursor");
  });

  it("continues after the key in the list's direction, ids as tiebreak", () => {
    expect(keysetCondition(KEYSET, undefined)).toBeNull();
    expect(keysetCondition(KEYSET, encodeCursor(["b", "id-2"]))).toStrictEqual({
      sql: "(p.name COLLATE NOCASE > ? OR (p.name COLLATE NOCASE = ? AND p.id > ?))",
      params: ["b", "b", "id-2"],
    });
    expect(
      keysetCondition({ ...KEYSET, order: "desc", idOrder: "desc" }, encodeCursor([3, "x"]))
    ).toStrictEqual({
      sql: "(p.name COLLATE NOCASE < ? OR (p.name COLLATE NOCASE = ? AND p.id < ?))",
      params: [3, 3, "x"],
    });
    expect(keysetCondition(KEYSET, encodeCursor([null, "x"]))).toStrictEqual({
      sql: "(p.name COLLATE NOCASE IS NULL AND p.id > ?)",
      params: ["x"],
    });
  });

  it("hands out a next cursor only for a full page", () => {
    const rows = [
      { name: "a", id: "1" },
      { name: "b", id: "2" },
    ];
    expect(nextCursor(rows, 2, (row) => [row.name, row.id])).toBe(encodeCursor(["b", "2"]));
    expect(nextCursor(rows, 3, (row) => [row.name, row.id])).toBeNull();
    expect(nextCursor([], 1, (row: { id: string }) => [null, row.id])).toBeNull();
  });
});
