import { describe, expect, test } from "bun:test";

import { cellText, filterText } from "./grid.presenter.ts";
import { buildRequest } from "./query.presenter.ts";

const MONGO = {
  op: "find" as const,
  collection: "orders",
  filter: '{"total":{"$gt":5}}',
  projection: "",
  sort: '{"_id":-1}',
  pipeline: "[]",
};

describe("data feature", () => {
  test("filters serialize as column:op:value and cells render null and JSON", () => {
    expect(filterText({ column: "status", op: "like", value: "pa%" })).toBe("status:like:pa%");
    expect(cellText(null)).toBe("NULL");
    expect(cellText("x")).toBe("x");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });

  test("buildRequest sends SQL text or a parsed mongo operation with the row cap", () => {
    expect(buildRequest(false, "SELECT 1", MONGO, "50")).toEqual({
      dialect: "sql",
      mode: "read",
      row_cap: 50,
      text: "SELECT 1",
    });
    expect(buildRequest(true, "", MONGO, "x")).toEqual({
      dialect: "mongo",
      mode: "read",
      mongo: { op: "find", collection: "orders", filter: { total: { $gt: 5 } }, sort: { _id: -1 } },
    });
    expect(() => buildRequest(true, "", { ...MONGO, filter: "{oops" }, "50")).toThrow(
      "filter is not valid JSON"
    );
  });
});
