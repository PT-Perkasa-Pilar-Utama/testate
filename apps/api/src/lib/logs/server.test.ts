import { describe, expect, it } from "bun:test";

import {
  decodeServerCursor,
  encodeServerCursor,
  isNewer,
  maskLiterals,
  pageWindow,
  withoutValues,
} from "./server.ts";

// #84, D4 and D7 (docs/decisions/2026-10-10-db-server-logs.md): a viewer never reads a value from
// a statement, and a page is ordered by (time, id) behind an opaque cursor.
describe("a statement shown to a masked reader", () => {
  it("loses its strings and numbers and keeps its placeholders and names", () => {
    expect(
      maskLiterals(
        "SELECT * FROM users u2 WHERE email = 'a@b.c' AND id = 42 AND total > -3.5 AND n = $1 AND m = ?"
      )
    ).toBe("SELECT * FROM users u2 WHERE email = ? AND id = ? AND total > ? AND n = $1 AND m = ?");
  });

  it("takes out escaped and double-quoted strings whole", () => {
    expect(maskLiterals(`UPDATE t SET note = 'it''s \\'fine\\'', tag = "x y" WHERE k = 'z'`)).toBe(
      "UPDATE t SET note = ?, tag = ? WHERE k = ?"
    );
  });

  it("shows a MongoDB command's keys and none of its values", () => {
    expect(
      withoutValues({ find: "users", filter: { email: "a@b.c", age: { $gt: 30 } }, limit: 5 })
    ).toEqual({
      find: "?",
      filter: { email: "?", age: { $gt: "?" } },
      limit: "?",
    });
  });
});

describe("the server-log cursor", () => {
  it("orders by time, then by id, and round-trips opaque", () => {
    const cursor = { before: { time: 10, id: "b" }, after: null };
    expect([
      isNewer({ time: 11, id: "a" }, { time: 10, id: "z" }),
      isNewer({ time: 10, id: "b" }, { time: 10, id: "a" }),
      isNewer({ time: 10, id: "a" }, { time: 10, id: "a" }),
      decodeServerCursor(encodeServerCursor(cursor)),
    ]).toEqual([true, true, false, cursor]);
  });

  it("refuses a cursor it did not give out", () => {
    expect(() => decodeServerCursor("bm90LWEtY3Vyc29y")).toThrow(
      "that cursor was not given out by this server"
    );
  });
});

describe("a page of a bounded window", () => {
  const at = (time: number, id: string) => ({ key: { time, id } });
  const window = [at(1, "a"), at(3, "a"), at(2, "b"), at(2, "a"), at(4, "a")];
  const ids = (page: { entries: { key: { time: number; id: string } }[] }) =>
    page.entries.map((entry) => `${entry.key.time}${entry.key.id}`);

  it("is newest first, and the next page starts strictly after the last one, even on a tie", () => {
    const first = pageWindow(window, { limit: 2, before: null, after: null });
    const second = pageWindow(window, { limit: 2, before: { time: 2, id: "b" }, after: null });
    const last = pageWindow(window, { limit: 2, before: { time: 2, id: "a" }, after: null });
    expect([ids(first), first.end, ids(second), second.end, ids(last), last.end]).toEqual([
      ["4a", "3a"],
      false,
      ["2a", "1a"],
      true,
      ["1a"],
      true,
    ]);
  });

  it("follows with only what came after the mark, never the mark again", () => {
    expect(
      ids(pageWindow(window, { limit: 10, before: null, after: { time: 2, id: "b" } }))
    ).toEqual(["4a", "3a"]);
  });
});
