import * as v from "valibot";

import { idSchema, timestampSchema } from "./common.ts";
import { jsonObjectSchema } from "./json.ts";

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
  project: v.nullable(v.object({ id: v.nullable(idSchema), slug: v.string() })),
  adapter: v.nullable(v.object({ id: v.nullable(idSchema), name: v.string() })),
  details: jsonObjectSchema,
  outcome: v.nullable(v.picklist(["succeeded", "failed", "partial"])),
  ip: v.nullable(v.string()),
  user_agent: v.nullable(v.string()),
  created_at: timestampSchema,
});
export type AuditRow = v.InferOutput<typeof auditRowSchema>;

export const auditQuerySchema = v.object({
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
  project_id: v.optional(idSchema),
  actor: v.optional(v.string()),
  action: v.optional(v.string()),
  from: v.optional(timestampSchema),
  to: v.optional(timestampSchema),
  outcome: v.optional(v.picklist(["succeeded", "failed", "partial"])),
});
