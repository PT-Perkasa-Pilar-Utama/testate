import type { ArchiveManifest, State, StateTreeNode } from "@testate/shared";

import {
  ADAPTER_ID,
  EARLIER,
  JOB_ID,
  NOW,
  QA_ACTOR,
  STASH_ID,
  STATE_ID,
  STATE_INIT_ID,
} from "../../lib/mock/fixtures.ts";

const ADAPTER_ENTRY: State["adapters"][number] = {
  adapter_id: ADAPTER_ID,
  adapter_name: "orders-db",
  engine: "postgres",
  engine_version: "16.3",
  fingerprint: "sha256:9f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
  consistency: "snapshot",
  removed: false,
  row_count: 120433,
  byte_count: 8123001,
  warnings: [],
};

export const INIT_STATE_MOCK: State = {
  id: STATE_INIT_ID,
  name: "init",
  kind: "init",
  status: "ready",
  protected: true,
  notes: null,
  tags: [],
  parent_state_id: null,
  stash_reason: null,
  adapters: [ADAPTER_ENTRY],
  size_bytes: 8123001,
  actor: { ...QA_ACTOR },
  job_id: JOB_ID,
  created_at: EARLIER,
  updated_at: EARLIER,
};

export const STATE_MOCK: State = {
  ...INIT_STATE_MOCK,
  id: STATE_ID,
  name: "seeded-baseline",
  kind: "manual",
  protected: true,
  notes: "After db:seed:qa on 2026-08-28",
  tags: ["baseline"],
  parent_state_id: STATE_INIT_ID,
  created_at: NOW,
  updated_at: NOW,
};

export const STASH_MOCK: State = {
  ...STATE_MOCK,
  id: STASH_ID,
  name: "stash-2026-08-28T08-00-00",
  kind: "stash",
  protected: false,
  notes: null,
  tags: [],
  parent_state_id: STATE_ID,
  stash_reason: "checkout",
};

export const MANIFEST_TABLES_MOCK = [
  {
    schema: "public",
    name: "orders",
    rows: 120433,
    bytes: 8123001,
    blob_hash: "9f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    sort: "primary-key",
    warnings: [],
  },
] as const;

export const TREE_MOCK: StateTreeNode[] = [
  {
    id: STATE_INIT_ID,
    name: "init",
    kind: "init",
    created_at: EARLIER,
    size_bytes: 8123001,
    is_head: false,
    children: [
      {
        id: STATE_ID,
        name: "seeded-baseline",
        kind: "manual",
        created_at: NOW,
        size_bytes: 8123001,
        is_head: true,
        children: [],
      },
    ],
  },
];

export const ARCHIVE_MANIFEST_MOCK: ArchiveManifest = {
  state: { name: "seeded-baseline", notes: null, tags: ["baseline"], created_at: NOW },
  adapters: [
    {
      archive_adapter_id: ADAPTER_ID,
      adapter_name: "orders-db",
      engine: "postgres",
      engine_version: "16.3",
      tables: 42,
      row_count: 120433,
      byte_count: 8123001,
    },
  ],
};
