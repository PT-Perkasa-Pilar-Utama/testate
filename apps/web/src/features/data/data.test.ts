import { at, documentId, entriesOf, fitting } from "./document.presenter.ts";
import type { Entry } from "./document.presenter.ts";
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
import { tokensOf } from "@/lib/json-tokens.ts";
import { buildRequest, mongoSample } from "./query.presenter.ts";

const MONGO = {
  op: "find" as const,
  collection: "orders",
  filter: '{"total":{"$gt":5}}',
  projection: "",
  sort: '{"_id":-1}',
  pipeline: "[]",
};

/** A field as one string: its text, or its kind when it is a container. */
function shown(field: Entry): string {
  return `${field.key}: ${field.text ?? field.kind}`;
}

const column = (name: string, type: string): TableSchema["columns"][number] => ({
  name,
  type,
  nullable: true,
  has_default: false,
  generated: false,
  identity: false,
  policy: { required_function: null, mask: null },
});

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

  test("a document lists one level of fields, and a path walks into nested ones", () => {
    const document = {
      _id: { $oid: "65f000000000000000000001" },
      total: { $numberDouble: "20.5" },
      tags: ["x"],
      customer: { name: "Ann", active: false },
      note: null,
    };
    expect(entriesOf(document).map(shown)).toStrictEqual([
      "_id: 65f000000000000000000001",
      "total: 20.5",
      "tags: array",
      "customer: object",
      "note: NULL",
    ]);
    expect(entriesOf(at(document, ["customer"])).map(shown)).toStrictEqual([
      'name: "Ann"',
      "active: false",
    ]);
    expect(entriesOf(at(document, ["tags"])).map(shown)).toStrictEqual(['0: "x"']);
    expect(at(document, ["customer", "missing"])).toBeNull();
    expect(fitting(document, ["customer", "missing", "deeper"])).toStrictEqual(["customer"]);
    expect(documentId({ _id: { $numberInt: "7" } })).toBe("7");
  });

  test("a document store's Extended JSON reads as plain values in a cell", () => {
    expect(cellText({ $numberInt: "1" })).toBe("1");
    expect(cellText({ $numberDouble: "20.5" })).toBe("20.5");
    expect(cellText({ $numberLong: "9007199254740993" })).toBe("9007199254740993");
    expect(cellText({ $oid: "65f000000000000000000001" })).toBe("65f000000000000000000001");
    expect(cellText({ $date: { $numberLong: "0" } })).toBe("1970-01-01T00:00:00.000Z");
    // A date past what Date can hold shows its digits rather than throwing off the screen.
    expect(cellText({ $date: { $numberLong: "99999999999999999999" } })).toBe(
      "99999999999999999999"
    );
    expect(cellText({ $date: { $numberLong: "not-a-number" } })).toBe("not-a-number");
    expect(cellText({ items: [{ $numberInt: "2" }], id: { $oid: "ab" } })).toBe(
      '{"items":[2],"id":"ab"}'
    );
    // A plain object with a dollar key that is not a wrapper stays what it is.
    expect(cellText({ $set: { a: 1 } })).toBe('{"$set":{"a":1}}');
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

  test("the Mongo sample fills every box from the collection's own fields and parses", () => {
    // `$options` is the introspection's pseudo column, never a field of a document.
    const draft = mongoSample("customers", ["_id", "$options", "email", "balance"]);
    expect(draft.collection).toBe("customers");
    expect(JSON.parse(draft.filter)).toEqual({ email: { $exists: true } });
    expect(JSON.parse(draft.projection)).toEqual({ _id: 1, email: 1, balance: 1 });
    expect(JSON.parse(draft.sort)).toEqual({ email: 1 });
    expect(JSON.parse(draft.pipeline)).toHaveLength(4);
    // Both operations the form offers go through the request builder as they are.
    expect(buildRequest(true, "", draft, "20").mongo?.op).toBe("find");
    expect(buildRequest(true, "", { ...draft, op: "aggregate" }, "20").mongo?.op).toBe("aggregate");
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
    // The columns are the live table's, so the form carries a cell per column rather than a
    // property per name; `column` is what ties a cell back to the schema.
    const cells = [
      { column: "id", mode: "value" as const, text: "1", fn: "now" as const, input: "" },
      { column: "email", mode: "value" as const, text: "b@x.io", fn: "now" as const, input: "" },
      { column: "name", mode: "null" as const, text: "A", fn: "now" as const, input: "" },
    ];
    // Only what changed: id still reads 1, so it is not in the update at all.
    expect(valuesOf(cells, table, original)).toEqual({
      email: { kind: "value", value: "b@x.io" },
      name: { kind: "null" },
    });
    // An insert has no original to compare against, so every cell travels.
    expect(Object.keys(valuesOf(cells, table, null))).toEqual(["id", "email", "name"]);
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

describe("the JSON view", () => {
  test("cuts pretty JSON into keys, strings, numbers, and literals", () => {
    const text = JSON.stringify({ a: "x", n: 1.5, t: true, z: null }, null, 2);
    const kinds = tokensOf(text)
      .filter((token) => token.kind !== "plain")
      .map((token) => `${token.kind}:${token.text}`);
    expect(kinds).toEqual([
      'key:"a"',
      'string:"x"',
      'key:"n"',
      "number:1.5",
      'key:"t"',
      "literal:true",
      'key:"z"',
      "literal:null",
    ]);
    // Every character survives: the tokens joined are the text.
    expect(
      tokensOf(text)
        .map((token) => token.text)
        .join("")
    ).toBe(text);
  });
});
