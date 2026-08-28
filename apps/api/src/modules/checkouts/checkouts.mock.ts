import type { Checkout, Preflight } from "@testate/shared";

import {
  ADAPTER_ID,
  ADAPTER_MONGO_ID,
  CHECKOUT_ID,
  EARLIER,
  JOB_ID,
  NOW,
  STASH_ID,
  STATE_ID,
  TOKEN_ACTOR,
} from "../../lib/mock/fixtures.ts";
import { PROBE_MOCK } from "../adapters/adapters.mock.ts";

export const CHECKOUT_MOCK: Checkout = {
  id: CHECKOUT_ID,
  state: { id: STATE_ID, name: "seeded-baseline" },
  job_id: JOB_ID,
  stash_state_id: STASH_ID,
  force: false,
  purpose: "checkout",
  status: "partial",
  adapters: [
    {
      adapter_id: ADAPTER_ID,
      name: "orders-db",
      engine: "postgres",
      result: "restored",
      strategy: PROBE_MOCK.strategy,
      rows: 120433,
      duration_ms: 17210,
      lock_wait_ms: 0,
      skipped_tables: [],
      skipped_columns: [],
      defaulted_columns: [],
      error: null,
    },
    {
      adapter_id: ADAPTER_MONGO_ID,
      name: "events-db",
      engine: "mongodb",
      result: "unknown",
      strategy: null,
      rows: null,
      duration_ms: null,
      lock_wait_ms: null,
      skipped_tables: [],
      skipped_columns: [],
      defaulted_columns: [],
      error: { code: "ADAPTER_UNREACHABLE", message: "connection refused" },
    },
  ],
  actor: { ...TOKEN_ACTOR },
  created_at: EARLIER,
  finished_at: NOW,
};

export const PREFLIGHT_MOCK: Preflight = {
  state: { id: STATE_ID, name: "seeded-baseline" },
  stash_will_be_taken: true,
  adapters: [
    {
      adapter_id: ADAPTER_ID,
      name: "orders-db",
      engine: "postgres",
      included: true,
      removed: false,
      drift: {
        changed: true,
        tables: { added: [], removed: [] },
        columns: {
          added: [{ table: "public.orders", column: "channel" }],
          removed: [],
          type_changed: [],
          nullability_changed: [],
        },
      },
      strategy: PROBE_MOCK.strategy,
      atomic: true,
      locking_notice: "Restored tables take an exclusive lock for the duration.",
      force_preview: {
        skipped_tables: [],
        skipped_columns: [],
        defaulted_columns: [{ table: "public.orders", column: "channel" }],
      },
    },
  ],
};
