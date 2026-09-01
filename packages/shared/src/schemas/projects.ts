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

// The messages are the ones a person reads, on the "New project" form and in the API's 400 alike
// (this schema parses the create request body too), so they are written here once.
export const createProjectSchema = v.object({
  /**
   * Omit it and the API derives one from the name, adding `-2`, `-3` until it is free. Send one and
   * you get exactly that slug or a 409: a script that names its own projects keeps working, and the
   * dialog, which cannot know what is taken, leaves the decision to the server.
   */
  // ponytail: mirrors slugSchema's pattern (common.ts) rather than piping it, so this field can
  // carry its own message. Keep the two patterns in sync; upgrade path is giving slugSchema itself
  // a message once every caller of it wants one.
  slug: v.optional(
    v.pipe(
      v.string(),
      v.regex(
        /^[a-z0-9-]{2,64}$/,
        "A slug is 2 to 64 characters: lowercase letters, digits, dashes."
      )
    )
  ),
  name: v.pipe(
    v.string(),
    v.minLength(1, "Enter a project name."),
    v.maxLength(120, "A project name is at most 120 characters.")
  ),
  /** Null or absent inherits the instance default; 0 is no quota at all. */
  quota_bytes: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
  description: v.optional(
    v.pipe(v.string(), v.maxLength(2000, "A description is at most 2000 characters."))
  ),
});
export type CreateProjectInput = v.InferOutput<typeof createProjectSchema>;

/** What a project inherits when it names no quota of its own; `/projects/defaults` serves it. */
export const projectDefaultsSchema = v.object({
  quota_bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type ProjectDefaults = v.InferOutput<typeof projectDefaultsSchema>;

export const updateProjectSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  description: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
  quota_bytes: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
});

// The "Edit project" dialog's own shape, not the PATCH body: every field of a PATCH may be omitted,
// which is not what a form means. The quota is not here at all any more: it is a slider over a
// ladder of sizes, the same control the create dialog uses, and it lives beside the form rather
// than inside it. `toUpdateBody` in the project presenter turns one into the other.
export const projectDraftSchema = v.object({
  name: v.pipe(
    v.string(),
    v.minLength(1, "Enter a project name."),
    v.maxLength(120, "A project name is at most 120 characters.")
  ),
  description: v.pipe(v.string(), v.maxLength(2000, "A description is at most 2000 characters.")),
});
export type ProjectDraft = v.InferOutput<typeof projectDraftSchema>;

export const quotaSchema = v.object({
  used_bytes: v.number(),
  quota_bytes: v.number(),
  warn_at_bytes: v.number(),
  instance_used_bytes: v.number(),
  instance_ceiling_bytes: v.nullable(v.number()),
});
export type Quota = v.InferOutput<typeof quotaSchema>;
