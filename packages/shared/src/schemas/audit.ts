import * as v from "valibot";

import { idSchema, timestampSchema } from "./common.ts";
import { jsonObjectSchema, jsonValueSchema } from "./json.ts";

export const auditRowSchema = v.object({
  id: idSchema,
  actor: v.object({
    kind: v.picklist(["user", "token", "system"]),
    id: v.nullable(idSchema),
    label: v.string(),
  }),
  action: v.string(),
  target_type: v.string(),
  target_id: v.string(),
  /** What it was called when this happened; null on rows written before the column existed. */
  target_label: v.nullable(v.string()),
  project: v.nullable(v.object({ id: v.nullable(idSchema), slug: v.string() })),
  adapter: v.nullable(v.object({ id: v.nullable(idSchema), name: v.string() })),
  details: jsonObjectSchema,
  outcome: v.nullable(v.picklist(["succeeded", "failed", "partial"])),
  ip: v.nullable(v.string()),
  user_agent: v.nullable(v.string()),
  /** The HTTP request that wrote the row; null for a job's or the system's, and for older rows. */
  request_id: v.nullable(v.string()),
  created_at: timestampSchema,
});
export type AuditRow = v.InferOutput<typeof auditRowSchema>;

/**
 * The request and the response behind a row, as the API kept them: secrets replaced whole,
 * identifiers shortened to their ends, each body cut at the size cap. `expired` means the row
 * had a request but its bodies passed `retention.audit_payload_days`; `none` means no request
 * wrote the row.
 */
export const auditPayloadSchema = v.object({
  state: v.picklist(["kept", "expired", "none"]),
  method: v.nullable(v.string()),
  path: v.nullable(v.string()),
  status: v.nullable(v.number()),
  /** A body cut at the cap arrives as the text that was kept, which is not JSON. */
  request: v.nullable(jsonValueSchema),
  response: v.nullable(jsonValueSchema),
  request_truncated: v.boolean(),
  response_truncated: v.boolean(),
});
export type AuditPayload = v.InferOutput<typeof auditPayloadSchema>;

export const auditQuerySchema = v.object({
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
  project_id: v.optional(idSchema),
  /** One substring match over the actor, the action and the target's name. */
  q: v.optional(v.string()),
  actor: v.optional(v.string()),
  action: v.optional(v.string()),
  from: v.optional(timestampSchema),
  to: v.optional(timestampSchema),
  outcome: v.optional(v.picklist(["succeeded", "failed", "partial"])),
});
