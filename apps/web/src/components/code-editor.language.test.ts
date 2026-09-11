import { describe, expect, it } from "bun:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { Introspection } from "@testate/shared";

import { mongoCompletions, sqlNamespaceOf } from "./code-editor.language.ts";

const column = (name: string): Introspection["tables"][number]["columns"][number] => ({
  name,
  type: "text",
  nullable: true,
  has_default: false,
  generated: false,
  identity: false,
  policy: { required_function: null, mask: null },
});

const table = (
  schema: string | null,
  name: string,
  columns: string[]
): Introspection["tables"][number] => ({
  schema,
  name,
  kind: "table",
  row_estimate: 0,
  columns: columns.map(column),
  primary_key: null,
  foreign_keys_out: [],
  foreign_keys_in: [],
  unique: [],
  unsupported: [],
  excluded: false,
  display_column: null,
});

const introspection = (tables: Introspection["tables"]): Introspection => ({
  tier: "tabular",
  fingerprint: "f",
  tables,
  views: [{ schema: tables[0]?.schema ?? null, name: "recent_orders" }],
  warnings: [],
});

describe("the SQL namespace behind completion", () => {
  it("nests tables under their schema and makes the first schema the default", () => {
    const { namespace, defaultSchema } = sqlNamespaceOf(
      introspection([table("public", "users", ["id", "email"]), table("audit", "events", ["at"])])
    );
    expect(namespace).toEqual({
      public: { users: ["id", "email"], recent_orders: [] },
      audit: { events: ["at"] },
    });
    expect(defaultSchema).toBe("public");
  });

  it("keeps an engine without schemas flat", () => {
    const { namespace, defaultSchema } = sqlNamespaceOf(
      introspection([table(null, "users", ["id"])])
    );
    expect(namespace).toEqual({ users: ["id"], recent_orders: [] });
    expect(defaultSchema).toBeUndefined();
  });
});

function complete(doc: string, fields: string[], explicit = false): string[] {
  const state = EditorState.create({ doc });
  const context = new CompletionContext(state, doc.length, explicit);
  const result = mongoCompletions(fields)(context);
  if (result === null || result instanceof Promise) return [];
  return result.options.map((option) => option.label);
}

describe("Mongo completion", () => {
  it("offers operators on a dollar word, fields on a bare one", () => {
    expect(complete('{"$ma', [])).toContain("$match");
    expect(complete('{"$ma', ["email"])).not.toContain("email");
    expect(complete('{"em', ["email", "name"])).toEqual(["email", "name"]);
  });

  it("stays quiet with nothing typed unless asked", () => {
    expect(complete("{", ["email"])).toEqual([]);
    expect(complete("{", ["email"], true)).toEqual(["email"]);
  });
});
