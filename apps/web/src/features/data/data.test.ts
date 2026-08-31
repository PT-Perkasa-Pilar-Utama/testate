import { describe, expect, test } from "bun:test";
import type { TableSchema } from "@testate/shared";

import {
  NUMERIC_TYPE,
  cellText,
  filterNeedsValue,
  filterText,
  filtersFromSearch,
  fkLink,
  parseFilterText,
} from "./grid.presenter.ts";
import { editsFor, pkOf, toFormValue, valuesOf } from "./editing.presenter.ts";
import { NONE, policyBody } from "./policies.presenter.ts";
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
    expect(parseFilterText("id:eq:1")).toStrictEqual({ column: "id", op: "eq", value: "1" });
    expect(parseFilterText("t:like:a:b")).toStrictEqual({ column: "t", op: "like", value: "a:b" });
    expect(parseFilterText("id:nope:1")).toBeNull();
    expect(filtersFromSearch("?filter=id%3Aeq%3A1&filter=bad")).toStrictEqual([
      { column: "id", op: "eq", value: "1" },
    ]);
    expect(cellText(null)).toBe("NULL");
    expect(cellText("x")).toBe("x");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });

  test("a filter with no value is refused before it reaches the API, and so is a link to one", () => {
    // The API's own rule (data.handler.ts parseFilter): only null and notnull take no value.
    expect(filterNeedsValue("eq")).toBe(true);
    expect(filterNeedsValue("like")).toBe(true);
    expect(filterNeedsValue("null")).toBe(false);
    expect(filterNeedsValue("notnull")).toBe(false);

    const orders: TableSchema = {
      schema: "contract",
      name: "orders",
      kind: "table",
      row_estimate: 0,
      columns: [],
      primary_key: ["id"],
      foreign_keys_out: [
        {
          columns: ["customer_id"],
          ref: { schema: "contract", name: "customers" },
          ref_columns: ["id"],
        },
      ],
      foreign_keys_in: [],
      unique: [],
      unsupported: [],
      excluded: false,
      display_column: null,
    };
    expect(fkLink("demo", "a1", orders, "customer_id", "42")).toBe(
      "/projects/demo/adapters/a1/tables/contract.customers?filter=id%3Aeq%3A42"
    );
    // A null or empty FK renders as nothing to filter on, so it must not be a link at all.
    expect(fkLink("demo", "a1", orders, "customer_id", null)).toBeNull();
    expect(fkLink("demo", "a1", orders, "customer_id", "")).toBeNull();
  });

  test("Save on a row nobody changed sends nothing, because an empty update is invalid SQL", () => {
    const draft = new Map();
    const changed = { email: { kind: "value" as const, value: "b@x.io" } };
    expect(editsFor({ kind: "update", pk: { id: 1 }, original: {}, draft }, changed, 1)).toEqual([
      { kind: "update", pk: { id: 1 }, values: changed },
    ]);
    expect(editsFor({ kind: "update", pk: { id: 1 }, original: {}, draft }, {}, 1)).toBeNull();
    // An insert with no values is still an insert: every column takes its default.
    expect(editsFor({ kind: "insert", draft }, {}, 2)).toEqual([
      { kind: "insert", values: {} },
      { kind: "insert", values: {} },
    ]);
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
    expect(() => buildRequest(true, "", { ...MONGO, collection: "" }, "50")).toThrow(
      "Invalid length"
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

  test("policyBody turns the none choices into nulls", () => {
    expect(
      policyBody({ table: "t", column: "c", fn: "hash_bcrypt", mask: NONE, display: true })
    ).toEqual({ required_function: { name: "hash_bcrypt" }, mask: null, display: true });
    expect(
      policyBody({ table: "t", column: "c", fn: NONE, mask: "redact", display: false })
    ).toEqual({
      required_function: null,
      mask: "redact",
      display: false,
    });
  });
});

describe("the grid's numeric columns", () => {
  // Alignment is decided from the type name the engine reports, and the three engines report the
  // same idea in different words.
  test("recognises a number whatever the engine calls it", () => {
    const numbers = [
      "bigint",
      "int4",
      "int(11)",
      "smallserial",
      "numeric(24,4)",
      "decimal",
      "double precision",
      "float8",
      "real",
      "money",
      "long",
    ];
    expect(numbers.filter((type) => !NUMERIC_TYPE.test(type))).toEqual([]);
  });

  test("leaves everything else alone", () => {
    const others = ["text", "varchar(255)", "uuid", "jsonb", "timestamptz", "boolean", "bytea"];
    expect(others.filter((type) => NUMERIC_TYPE.test(type))).toEqual([]);
  });
});
