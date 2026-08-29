import { describe, expect, it } from "bun:test";
import type { Introspection, TableSchema } from "@testate/shared";

import { computeDependencyOrder } from "./dependency-order.ts";
import { diffSchema, forceIntersection } from "./diff-schema.ts";
import { canonicalType, computeFingerprint } from "./fingerprint.ts";

type Column = TableSchema["columns"][number];

function column(name: string, type: string, overrides: Partial<Column> = {}): Column {
  return {
    name,
    type,
    nullable: false,
    has_default: false,
    generated: false,
    identity: false,
    policy: { required_function: null, mask: null },
    ...overrides,
  };
}

function table(name: string, columns: Column[], overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    schema: "public",
    name,
    kind: "table",
    row_estimate: 0,
    columns,
    primary_key: ["id"],
    foreign_keys_out: [],
    foreign_keys_in: [],
    unique: [],
    unsupported: [],
    excluded: false,
    display_column: null,
    ...overrides,
  };
}

function introspection(tables: TableSchema[]): Introspection {
  return { tier: "tabular", fingerprint: "", tables, views: [], warnings: [] };
}

const ID_COLUMN = column("id", "bigint", { identity: true, has_default: true });

const ORDERS = table("orders", [ID_COLUMN, column("total", "numeric(12,2)", { nullable: true })]);

describe("fingerprint", () => {
  it("ignores column order, row estimates, and excluded tables", () => {
    const a = introspection([ORDERS, table("audit", [column("id", "int")], { excluded: true })]);
    const reordered = { ...ORDERS, columns: [...ORDERS.columns].reverse(), row_estimate: 999 };
    const b = introspection([reordered]);
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
    expect(computeFingerprint(a).startsWith("sha256:")).toBe(true);
  });

  it("changes on type, nullability, default, key, and foreign key changes", () => {
    const base = computeFingerprint(introspection([ORDERS]));
    const widened = {
      ...ORDERS,
      columns: [
        column("id", "bigint", { identity: true, has_default: true }),
        column("total", "numeric(14,2)", { nullable: true }),
      ],
    };
    const notNull = {
      ...ORDERS,
      columns: [ID_COLUMN, column("total", "numeric(12,2)")],
    };
    const keyed = { ...ORDERS, unique: [["total"]] };
    for (const variant of [widened, notNull, keyed]) {
      expect(computeFingerprint(introspection([variant]))).not.toBe(base);
    }
  });

  it("canonicalizes spellings", () => {
    expect(canonicalType("character varying(255)")).toBe("varchar(255)");
    expect(canonicalType("integer")).toBe("int");
    expect(canonicalType("timestamp with time zone")).toBe("timestamptz");
    expect(canonicalType("timestamp(3) without time zone")).toBe("timestamp(3)");
    expect(canonicalType("numeric(12,2)")).toBe("numeric(12,2)");
  });
});

describe("diffSchema and forceIntersection", () => {
  it("reports added, removed, type, and nullability changes", () => {
    const live = introspection([
      {
        ...ORDERS,
        columns: [
          column("id", "bigint", { identity: true, has_default: true }),
          column("total", "numeric(12,2)"),
          column("note", "text", { nullable: true }),
        ],
      },
      table("customers", [column("id", "int")]),
    ]);
    const drift = diffSchema(introspection([ORDERS, table("legacy", [column("id", "int")])]), live);
    expect(drift.changed).toBe(true);
    expect(drift.tables).toStrictEqual({ added: ["public.customers"], removed: ["public.legacy"] });
    expect(drift.columns.added).toStrictEqual([{ table: "public.orders", column: "note" }]);
    expect(drift.columns.nullability_changed).toStrictEqual([
      { table: "public.orders", column: "total" },
    ]);
    expect(diffSchema(live, live).changed).toBe(false);
  });

  it("skips a table whose new column has no default and lists defaulted and skipped columns", () => {
    const base = introspection([
      ORDERS,
      table("items", [column("id", "int"), column("qty", "int")]),
    ]);
    const live = introspection([
      { ...ORDERS, columns: [...ORDERS.columns, column("note", "text", { nullable: true })] },
      table("items", [column("id", "int"), column("qty", "bigint"), column("sku", "text")]),
    ]);
    const forced = forceIntersection(base, live);
    expect(forced.tables).toStrictEqual([{ schema: "public", name: "orders" }]);
    expect(forced.skippedTables).toStrictEqual([{ schema: "public", name: "items" }]);
    expect(forced.defaultedColumns).toStrictEqual([
      { table: { schema: "public", name: "orders" }, column: "note" },
    ]);
  });
});

describe("computeDependencyOrder", () => {
  const customers = table("customers", [column("id", "int")], {
    foreign_keys_in: [{ from: { schema: "public", name: "orders" }, columns: ["customer_id"] }],
  });
  const orders = table("orders", [column("id", "int"), column("customer_id", "int")], {
    foreign_keys_out: [
      {
        columns: ["customer_id"],
        ref: { schema: "public", name: "customers" },
        ref_columns: ["id"],
        deferrable: false,
      },
    ],
    foreign_keys_in: [{ from: { schema: "public", name: "items" }, columns: ["order_id"] }],
  });
  const items = table("items", [column("id", "int"), column("order_id", "int")], {
    foreign_keys_out: [
      {
        columns: ["order_id"],
        ref: { schema: "public", name: "orders" },
        ref_columns: ["id"],
        deferrable: false,
      },
    ],
  });

  it("orders parents first and widens the truncate set to referencing tables", () => {
    const plan = computeDependencyOrder(
      [customers, orders, items],
      [
        { schema: "public", name: "customers" },
        { schema: "public", name: "orders" },
      ]
    );
    expect(plan.order.map((ref) => ref.name)).toStrictEqual(["customers", "orders"]);
    expect(plan.truncateSet.map((ref) => ref.name).sort()).toStrictEqual([
      "customers",
      "items",
      "orders",
    ]);
    expect(plan.outsideReferencers.map((ref) => ref.name)).toStrictEqual(["items"]);
  });

  it("flags self references and refuses cycles between tables", () => {
    const tree = table(
      "nodes",
      [column("id", "int"), column("parent_id", "int", { nullable: true })],
      {
        foreign_keys_out: [
          {
            columns: ["parent_id"],
            ref: { schema: "public", name: "nodes" },
            ref_columns: ["id"],
            deferrable: false,
          },
        ],
      }
    );
    expect(
      computeDependencyOrder([tree], [{ schema: "public", name: "nodes" }]).selfReferencing.map(
        (ref) => ref.name
      )
    ).toStrictEqual(["nodes"]);
    const a = table("a", [column("id", "int")], {
      foreign_keys_out: [
        {
          columns: ["b_id"],
          ref: { schema: "public", name: "b" },
          ref_columns: ["id"],
          deferrable: false,
        },
      ],
    });
    const b = table("b", [column("id", "int")], {
      foreign_keys_out: [
        {
          columns: ["a_id"],
          ref: { schema: "public", name: "a" },
          ref_columns: ["id"],
          deferrable: false,
        },
      ],
    });
    expect(() =>
      computeDependencyOrder(
        [a, b],
        [
          { schema: "public", name: "a" },
          { schema: "public", name: "b" },
        ]
      )
    ).toThrow("cycle");
  });
});
