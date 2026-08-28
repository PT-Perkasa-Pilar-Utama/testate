import type { Adapter, ProbeResult } from "@testate/shared";

import {
  ADAPTER_ID,
  ADAPTER_MONGO_ID,
  EARLIER,
  NOW,
  PLAN_ID,
  PROJECT_ID,
  REST_ADAPTER_ID,
  STORAGE_ADAPTER_ID,
} from "../../lib/mock/fixtures.ts";

export const PROBE_MOCK: ProbeResult = {
  engine: "postgres",
  dialect: "postgres",
  version: "16.3",
  meets_floor: true,
  floor: "13",
  tier: "tabular",
  capabilities: {
    canTruncate: true,
    canDisableTriggers: false,
    canTerminateSessions: true,
    supportsDeferrableConstraints: false,
    transactionalRestore: true,
    snapshotRead: "repeatable-read",
    timeSeriesDeletes: false,
  },
  strategy: {
    emptyMode: "truncate",
    foreignKeyHandling: "dependency-order",
    transactional: true,
    triggerDisable: false,
    locking: "table",
  },
  read_only_enforcement: "transaction",
  table_count: 42,
  size_estimate_bytes: 812345678,
  atomicity_notice:
    "Postgres restores are one transaction; restored tables are locked for the duration.",
  warnings: [],
};

export const ADAPTER_MOCK: Adapter = {
  id: ADAPTER_ID,
  project_id: PROJECT_ID,
  kind: "database",
  engine: "postgres",
  tier: "tabular",
  name: "orders-db",
  mode: "sandbox",
  status: "ok",
  status_message: null,
  config: {
    host: "pg.sit.internal",
    port: 5432,
    database: "shop",
    user: "testate",
    ssl: "prefer",
    schemas: ["public"],
  },
  credential: { set: true, set_at: EARLIER, key_fingerprint: "9f3c1a2b" },
  readonly_credential: { set: false },
  excluded_tables: ["public.schema_migrations"],
  restore_mode: "atomic",
  lock_timeout_ms: 60000,
  engine_version: "16.3",
  dialect: "postgres",
  capabilities: PROBE_MOCK.capabilities,
  strategy: PROBE_MOCK.strategy,
  read_only_enforcement: "transaction",
  last_probe_at: NOW,
  created_at: EARLIER,
  updated_at: NOW,
};

export const MONGO_ADAPTER_MOCK: Adapter = {
  ...ADAPTER_MOCK,
  id: ADAPTER_MONGO_ID,
  engine: "mongodb",
  tier: "document",
  name: "events-db",
  config: { database: "events" },
  engine_version: "7.0.12",
  dialect: "mongodb",
  read_only_enforcement: "filter",
};

export const STORAGE_ADAPTER_MOCK: Adapter = {
  ...ADAPTER_MOCK,
  id: STORAGE_ADAPTER_ID,
  kind: "storage",
  engine: "s3",
  tier: "files",
  name: "exports-bucket",
  mode: "read_only",
  config: {
    bucket: "shop-exports",
    prefix: "sit/",
    region: "ap-southeast-1",
    endpoint: null,
    virtual_hosted: true,
  },
  excluded_tables: [],
  engine_version: null,
  dialect: null,
  capabilities: null,
  strategy: null,
  read_only_enforcement: null,
};

export const REST_ADAPTER_MOCK: Adapter = {
  ...STORAGE_ADAPTER_MOCK,
  id: REST_ADAPTER_ID,
  kind: "rest",
  engine: "http",
  name: "shop-api",
  config: {
    base_url: "https://shop.sit.internal",
    timeout_ms: 30000,
    verify_tls: true,
    default_headers: { "X-Api-Version": "2" },
    secret_header_names: ["Authorization"],
  },
};

export const ADAPTER_DELETION_PLAN_MOCK = {
  plan_id: PLAN_ID,
  expires_at: "2026-08-28T08:15:00.000Z",
  adapter: { action: "restore", drift: null },
  states_referencing: 12,
} as const;
