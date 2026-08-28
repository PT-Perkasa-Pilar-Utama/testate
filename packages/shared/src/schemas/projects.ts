import * as v from "valibot";

import { headStatusSchema } from "../enums.ts";
import { idSchema, slugSchema, timestampSchema } from "./common.ts";

export const headSchema = v.object({
  status: headStatusSchema,
  state_id: v.nullable(idSchema),
  state_name: v.nullable(v.string()),
  changed_at: v.nullable(timestampSchema),
});
export type Head = v.InferOutput<typeof headSchema>;

export const projectSchema = v.object({
  id: idSchema,
  slug: slugSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  description: v.nullable(v.string()),
  quota_bytes: v.nullable(v.number()),
  head: headSchema,
  created_by: idSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Project = v.InferOutput<typeof projectSchema>;

export const createProjectSchema = v.object({
  slug: slugSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  description: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});
export type CreateProjectInput = v.InferOutput<typeof createProjectSchema>;

export const updateProjectSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  description: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
  quota_bytes: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
});

export const quotaSchema = v.object({
  used_bytes: v.number(),
  quota_bytes: v.number(),
  warn_at_bytes: v.number(),
  instance_used_bytes: v.number(),
  instance_ceiling_bytes: v.nullable(v.number()),
});
export type Quota = v.InferOutput<typeof quotaSchema>;
