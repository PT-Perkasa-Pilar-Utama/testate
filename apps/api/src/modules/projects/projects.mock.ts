import type { Job, Project, Quota } from "@testate/shared";

import {
  ADAPTER_ID,
  ADMIN_ID,
  EARLIER,
  JOB_ID,
  NOW,
  PLAN_ID,
  PROJECT_ID,
  PROJECT_SLUG,
  STATE_ID,
  TOKEN_ACTOR,
} from "../../lib/mock/fixtures.ts";

export const PROJECT_MOCK: Project = {
  id: PROJECT_ID,
  slug: PROJECT_SLUG,
  name: "Shop",
  description: "Web shop under test in SIT",
  quota_bytes: 10737418240,
  head: { status: "at_state", state_id: STATE_ID, state_name: "seeded-baseline", changed_at: NOW },
  created_by: ADMIN_ID,
  created_at: EARLIER,
  updated_at: NOW,
};

export const QUOTA_MOCK: Quota = {
  used_bytes: 3221225472,
  quota_bytes: 10737418240,
  warn_at_bytes: 8589934592,
  instance_used_bytes: 9663676416,
  instance_ceiling_bytes: null,
};

export const PROJECT_JOB_MOCK: Job = {
  id: JOB_ID,
  kind: "checkout",
  status: "succeeded",
  queue_position: null,
  project_id: PROJECT_ID,
  adapter_ids: [ADAPTER_ID],
  progress: { phase: "done" },
  result: { restored: 1 },
  error: null,
  cancel_requested: false,
  actor: { ...TOKEN_ACTOR },
  parent_request_id: null,
  created_at: EARLIER,
  started_at: EARLIER,
  finished_at: NOW,
};

export const DELETION_PLAN_MOCK = {
  plan_id: PLAN_ID,
  expires_at: "2026-08-28T08:15:00.000Z",
  protected_states: 3,
  affected: {
    adapters: 2,
    states: 12,
    protected_states: 3,
    checkouts: 5,
    diffs: 1,
    import_runs: 4,
    saved_queries: 2,
    hooks: 1,
    tokens: 1,
  },
  adapters: [
    {
      adapter_id: ADAPTER_ID,
      name: "orders-db",
      engine: "postgres",
      init_state_id: STATE_ID,
      action: "restore",
      drift: null,
    },
  ],
} as const;
