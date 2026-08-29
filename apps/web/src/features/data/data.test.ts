import { describe, expect, test } from "bun:test";
import type { TableSchema } from "@testate/shared";

import { cellText, filterText } from "./grid.presenter.ts";
import { pkOf, toFormValue, valuesOf } from "./editing.presenter.ts";
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

  test("form fields become typed FormValues and updates carry only changed columns", () => {
    expect(toFormValue({ mode: "value", text: "42", fn: "now", input: "" }, "integer")).toEqual({
      kind: "value",
      value: 42,
    });
    expect(toFormValue({ mode: "value", text: "42", fn: "now", input: "" }, "bigint")).toEqual({
      kind: "value",
      value: "42",
    });
    expect(
      toFormValue({ mode: "function", text: "", fn: "hash_bcrypt", input: "pw" }, "text")
    ).toEqual({
      kind: "function",
      name: "hash_bcrypt",
      input: "pw",
    });
    const column = (name: string, type: string): TableSchema["columns"][number] => ({
      name,
      type,
      nullable: true,
      has_default: false,
      generated: false,
      identity: false,
      policy: { required_function: null, mask: null },
    });
    const table: TableSchema = {
      schema: "public",
      name: "customers",
      kind: "table",
      row_estimate: 0,
      columns: [column("id", "integer"), column("email", "text"), column("name", "text")],
      primary_key: ["id"],
      foreign_keys_out: [],
      foreign_keys_in: [],
      unique: [],
      unsupported: [],
      excluded: false,
      display_column: null,
    };
    const original = { id: 1, email: "a@x.io", name: "A" };
    expect(pkOf(original, table)).toEqual({ id: 1 });
    const draft = new Map([
      ["id", { mode: "value" as const, text: "1", fn: "now" as const, input: "" }],
      ["email", { mode: "value" as const, text: "b@x.io", fn: "now" as const, input: "" }],
      ["name", { mode: "null" as const, text: "A", fn: "now" as const, input: "" }],
    ]);
    expect(valuesOf(draft, table, original)).toEqual({
      email: { kind: "value", value: "b@x.io" },
      name: { kind: "null" },
    });
  });
});
