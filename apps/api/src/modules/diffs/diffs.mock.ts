import type { Diff, DiffRow } from "@testate/shared";

import { ADAPTER_ID, DIFF_ID, NOW, STATE_ID, STATE_INIT_ID } from "../../lib/mock/fixtures.ts";

export const DIFF_MOCK: Diff = {
  id: DIFF_ID,
  status: "ready",
  base: { id: STATE_INIT_ID, name: "init" },
  target: { id: STATE_ID, name: "seeded-baseline" },
  expires_at: "2026-09-04T08:00:00.000Z",
  adapters: [
    {
      adapter_id: ADAPTER_ID,
      name: "orders-db",
      engine: "postgres",
      compared: true,
      tables: [
        {
          schema: "public",
          name: "orders",
          compare: "primary-key",
          added: 12,
          removed: 0,
          changed: 3,
          unchanged: false,
          schema_changed: null,
        },
      ],
    },
  ],
  created_at: NOW,
};

export const DIFF_ROWS_MOCK: DiffRow[] = [
  {
    k: ["88213"],
    op: "changed",
    before: { id: "88213", status: "pending", total: "120.00" },
    after: { id: "88213", status: "paid", total: "120.00" },
    changed_columns: ["status"],
  },
  {
    k: ["88214"],
    op: "added",
    before: null,
    after: { id: "88214", status: "pending", total: "42.00" },
  },
];
