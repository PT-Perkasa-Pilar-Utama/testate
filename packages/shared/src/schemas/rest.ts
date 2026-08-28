import * as v from "valibot";

import { hookTriggerSchema } from "../enums.ts";
import { idSchema, timestampSchema } from "./common.ts";

export const httpMethodSchema = v.picklist(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export const restRequestBodySchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  method: httpMethodSchema,
  path: v.pipe(v.string(), v.startsWith("/")),
  query: v.optional(v.record(v.string(), v.string()), {}),
  headers: v.optional(v.record(v.string(), v.string()), {}),
  secrets: v.optional(v.record(v.string(), v.string()), {}),
  body: v.optional(v.nullable(v.string())),
  expected_status: v.optional(v.nullable(v.pipe(v.number(), v.integer()))),
});

export const restRequestSchema = v.object({
  id: idSchema,
  name: v.string(),
  method: httpMethodSchema,
  path: v.string(),
  query: v.record(v.string(), v.string()),
  headers: v.record(v.string(), v.string()),
  secret_headers: v.array(v.string()),
  body: v.nullable(v.string()),
  expected_status: v.nullable(v.number()),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type RestRequest = v.InferOutput<typeof restRequestSchema>;

export const runRequestSchema = v.object({
  placeholders: v.optional(
    v.object({
      state: v.optional(v.object({ id: idSchema, name: v.string() })),
      job: v.optional(v.object({ id: idSchema })),
    })
  ),
});

export const restRunSchema = v.object({
  run_id: idSchema,
  status_code: v.nullable(v.number()),
  duration_ms: v.number(),
  response_headers: v.record(v.string(), v.string()),
  response_body: v.nullable(v.string()),
  truncated: v.boolean(),
  matched_expected: v.nullable(v.boolean()),
  error: v.nullable(v.string()),
  created_at: timestampSchema,
});
export type RestRun = v.InferOutput<typeof restRunSchema>;

export const hookSchema = v.object({
  id: idSchema,
  trigger: hookTriggerSchema,
  request: v.object({ id: idSchema, adapter_id: idSchema, name: v.string() }),
  position: v.number(),
  enabled: v.boolean(),
  fail_policy: v.picklist(["abort", "continue"]),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Hook = v.InferOutput<typeof hookSchema>;

export const createHookSchema = v.object({
  trigger: hookTriggerSchema,
  rest_request_id: idSchema,
  fail_policy: v.optional(v.picklist(["abort", "continue"]), "continue"),
  enabled: v.optional(v.boolean(), true),
});

export const updateHookSchema = v.object({
  enabled: v.optional(v.boolean()),
  fail_policy: v.optional(v.picklist(["abort", "continue"])),
  rest_request_id: v.optional(idSchema),
});

export const reorderHooksSchema = v.object({
  trigger: hookTriggerSchema,
  hook_ids: v.array(idSchema),
});

export const hookRunSchema = v.object({
  hook_id: idSchema,
  trigger: hookTriggerSchema,
  request_run_id: v.nullable(idSchema),
  status: v.picklist(["succeeded", "failed", "skipped"]),
  status_code: v.nullable(v.number()),
  duration_ms: v.nullable(v.number()),
  policy: v.picklist(["abort", "continue"]),
});
