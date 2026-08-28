import * as v from "valibot";

import { jobKindSchema, jobStatusSchema } from "../enums.ts";
import { actorSchema, idSchema, timestampSchema } from "./common.ts";
import { jsonObjectSchema } from "./json.ts";

export const jobErrorSchema = v.object({
  code: v.string(),
  message: v.string(),
  details: v.optional(jsonObjectSchema),
});

export const jobSchema = v.object({
  id: idSchema,
  kind: jobKindSchema,
  status: jobStatusSchema,
  queue_position: v.nullable(v.number()),
  project_id: v.nullable(idSchema),
  adapter_ids: v.array(idSchema),
  progress: v.nullable(jsonObjectSchema),
  result: v.nullable(jsonObjectSchema),
  error: v.nullable(jobErrorSchema),
  cancel_requested: v.boolean(),
  actor: actorSchema,
  parent_request_id: v.nullable(v.string()),
  created_at: timestampSchema,
  started_at: v.nullable(timestampSchema),
  finished_at: v.nullable(timestampSchema),
});
export type Job = v.InferOutput<typeof jobSchema>;

export const jobListQuerySchema = v.object({
  cursor: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
  project_id: v.optional(idSchema),
  adapter_id: v.optional(idSchema),
  kind: v.optional(jobKindSchema),
  status: v.optional(jobStatusSchema),
});

export const waitQuerySchema = v.object({
  wait: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(300))),
});
