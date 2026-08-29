import type {
  ColumnPolicy,
  Fixture,
  Introspection,
  QueryResult,
  RowsPage,
  WriteSession,
} from "@testate/shared";

import { ADAPTER_ID, NOW, QUERY_ID, STASH_ID, WRITE_SESSION_ID } from "../../lib/mock/fixtures.ts";

export const INTROSPECTION_MOCK: Introspection = {
  tier: "tabular",
  fingerprint: "sha256:9f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
  tables: [
    {
      schema: "public",
      name: "orders",
      kind: "table",
      row_estimate: 120433,
      columns: [
        {
          name: "id",
          type: "bigint",
          nullable: false,
          has_default: true,
          generated: false,
          identity: true,
          policy: { required_function: null, mask: null },
        },
        {
          name: "customer_id",
          type: "bigint",
          nullable: false,
          has_default: false,
          generated: false,
          identity: false,
          policy: { required_function: null, mask: null },
        },
        {
          name: "status",
          type: "text",
          nullable: false,
          has_default: true,
          generated: false,
          identity: false,
          policy: { required_function: null, mask: null },
        },
        {
          name: "card_last4",
          type: "text",
          nullable: true,
          has_default: false,
          generated: false,
          identity: false,
          policy: { required_function: null, mask: "redact" },
        },
      ],
      primary_key: ["id"],
      foreign_keys_out: [
        {
          columns: ["customer_id"],
          ref: { schema: "public", name: "customers" },
          ref_columns: ["id"],
          deferrable: false,
        },
      ],
      foreign_keys_in: [{ from: { schema: "public", name: "order_items" }, columns: ["order_id"] }],
      unique: [["order_number"]],
      unsupported: [],
      excluded: false,
      display_column: "order_number",
    },
  ],
  views: [{ schema: "public", name: "order_totals" }],
  warnings: [],
};

export const ROWS_PAGE_MOCK: RowsPage = {
  data: [
    {
      id: "88213",
      customer_id: 5120,
      status: "paid",
      card_last4: "***",
      _display: { customer_id: "Dina Putri" },
    },
  ],
  page: { next_cursor: null, limit: 100, kind: "keyset" },
  columns: [
    { name: "id", type: "bigint" },
    { name: "customer_id", type: "bigint" },
    { name: "status", type: "text" },
    { name: "card_last4", type: "text" },
  ],
  masked_columns: ["card_last4"],
};

export const WRITE_SESSION_MOCK: WriteSession = {
  id: WRITE_SESSION_ID,
  adapter_id: ADAPTER_ID,
  started_at: NOW,
  foreign_key_checks: true,
  fk_checks_mapping: "SET CONSTRAINTS ALL DEFERRED",
  stash_state_id: STASH_ID,
  expires_at: "2026-08-28T08:30:00.000Z",
};

export const QUERY_RESULT_MOCK: QueryResult = {
  query_id: QUERY_ID,
  columns: [
    { name: "id", type: "bigint" },
    { name: "status", type: "text" },
  ],
  rows: [{ id: "88213", status: "paid" }],
  rows_affected: null,
  truncated: { rows: false, bytes: false, time: false },
  duration_ms: 41,
  read_only_enforcement: "transaction",
  masked_columns: [],
};

export const COLUMN_POLICY_MOCK: ColumnPolicy = {
  table: "public.users",
  column: "password_hash",
  required_function: { name: "hash_bcrypt", params: { cost: 12 } },
  mask: "redact",
  display: false,
  locked: true,
  updated_at: NOW,
};

export const FIXTURE_MOCK: Fixture = {
  format: "sql",
  content:
    "INSERT INTO public.customers (id, email) VALUES (5120, '***');\nINSERT INTO public.orders (id, customer_id, status) VALUES (88213, 5120, 'paid');\n",
  rows: 2,
  tables: ["public.customers", "public.orders"],
  truncated: false,
  masked_columns: ["public.customers.email"],
};
