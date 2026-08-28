/**
 * Shared identifiers for Sprint 0 mocks, so every module's mock cross-references
 * the same project, adapter, state, user, and job. Replaced by real rows card by card.
 */
export const NOW = "2026-08-28T08:00:00.000Z";
export const EARLIER = "2026-08-28T07:00:00.000Z";

export const USER_ID = "01991f00-0000-7000-8000-000000000001";
export const ADMIN_ID = "01991f00-0000-7000-8000-000000000002";
export const TOKEN_ID = "01991f00-0000-7000-8000-000000000003";
export const PROJECT_ID = "01991f00-0000-7000-8000-000000000010";
export const PROJECT_SLUG = "shop";
export const ADAPTER_ID = "01991f00-0000-7000-8000-000000000020";
export const ADAPTER_MONGO_ID = "01991f00-0000-7000-8000-000000000021";
export const STORAGE_ADAPTER_ID = "01991f00-0000-7000-8000-000000000022";
export const REST_ADAPTER_ID = "01991f00-0000-7000-8000-000000000023";
export const STATE_INIT_ID = "01991f00-0000-7000-8000-000000000030";
export const STATE_ID = "01991f00-0000-7000-8000-000000000031";
export const STASH_ID = "01991f00-0000-7000-8000-000000000032";
export const JOB_ID = "01991f00-0000-7000-8000-000000000040";
export const CHECKOUT_ID = "01991f00-0000-7000-8000-000000000050";
export const DIFF_ID = "01991f00-0000-7000-8000-000000000060";
export const MAPPING_ID = "01991f00-0000-7000-8000-000000000070";
export const IMPORT_RUN_ID = "01991f00-0000-7000-8000-000000000071";
export const UPLOAD_ID = "01991f00-0000-7000-8000-000000000072";
export const REQUEST_ID = "01991f00-0000-7000-8000-000000000080";
export const HOOK_ID = "01991f00-0000-7000-8000-000000000081";
export const SESSION_ID = "01991f00-0000-7000-8000-000000000090";
export const WRITE_SESSION_ID = "01991f00-0000-7000-8000-000000000091";
export const QUERY_ID = "01991f00-0000-7000-8000-000000000092";
export const AUDIT_ID = "01991f00-0000-7000-8000-000000000093";
export const PLAN_ID = "01991f00-0000-7000-8000-000000000094";

export const QA_ACTOR = {
  kind: "user",
  id: USER_ID,
  label: "dina.qa",
  role: "qa",
  agent: false,
} as const;

export const TOKEN_ACTOR = {
  kind: "token",
  id: TOKEN_ID,
  label: "token:ci-shop",
  role: "qa",
  agent: false,
} as const;
