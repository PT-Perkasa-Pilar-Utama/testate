import type { Hook, RestRequest, RestRun } from "@testate/shared";

import { EARLIER, HOOK_ID, NOW, REQUEST_ID, REST_ADAPTER_ID } from "../../lib/mock/fixtures.ts";

export const REST_REQUEST_MOCK: RestRequest = {
  id: REQUEST_ID,
  name: "clear-cache",
  method: "POST",
  path: "/internal/cache/clear",
  query: { scope: "all" },
  headers: { "X-Trace": "testate-{{job.id}}" },
  secret_headers: ["X-Internal-Key"],
  body: '{"reason":"checkout {{state.name}}"}',
  expected_status: 200,
  created_at: EARLIER,
  updated_at: NOW,
};

export const REST_RUN_MOCK: RestRun = {
  run_id: "01991f00-0000-7000-8000-000000000082",
  status_code: 200,
  duration_ms: 310,
  response_headers: { "content-type": "application/json" },
  response_body: '{"cleared":true}',
  truncated: false,
  matched_expected: true,
  error: null,
  created_at: NOW,
};

export const HOOK_MOCK: Hook = {
  id: HOOK_ID,
  trigger: "after_checkout",
  request: { id: REQUEST_ID, adapter_id: REST_ADAPTER_ID, name: "clear-cache" },
  position: 1,
  enabled: true,
  fail_policy: "continue",
  created_at: EARLIER,
  updated_at: NOW,
};
