import * as v from "valibot";

import { roleSchema, tokenKindSchema } from "../enums.ts";
import { actorSchema, idSchema, timestampSchema } from "./common.ts";

export const PASSWORD_MIN_LENGTH = 12;

// The messages are the ones a person reads, on the sign-in form and in the API's 400 alike, so
// they are written here once rather than left as valibot's "Invalid length: Expected >=1".
export const loginSchema = v.object({
  username: v.pipe(
    v.string(),
    v.minLength(1, "Enter your username."),
    v.maxLength(64, "A username is at most 64 characters.")
  ),
  password: v.pipe(
    v.string(),
    v.minLength(1, "Enter your password."),
    v.maxLength(1024, "That password is too long to be one of ours.")
  ),
});
export type LoginInput = v.InferOutput<typeof loginSchema>;

export const userSummarySchema = v.object({
  id: idSchema,
  username: v.string(),
  display_name: v.string(),
  role: roleSchema,
});

export const loginResponseSchema = v.object({
  user: userSummarySchema,
  must_change_password: v.boolean(),
});
export type LoginResponse = v.InferOutput<typeof loginResponseSchema>;

export const meSchema = v.object({
  actor: actorSchema,
  must_change_password: v.boolean(),
  project_scope: v.nullable(v.array(idSchema)),
  env: v.optional(v.picklist(["development", "test", "production"])),
});
export type Me = v.InferOutput<typeof meSchema>;

export const changePasswordSchema = v.pipe(
  v.object({
    current: v.pipe(v.string(), v.minLength(1)),
    next: v.pipe(v.string(), v.minLength(PASSWORD_MIN_LENGTH), v.maxLength(1024)),
  }),
  v.check((input) => input.current !== input.next, "next must differ from current")
);
export type ChangePasswordInput = v.InferOutput<typeof changePasswordSchema>;

export const sessionSchema = v.object({
  id: idSchema,
  created_at: timestampSchema,
  last_seen_at: timestampSchema,
  ip: v.nullable(v.string()),
  user_agent: v.nullable(v.string()),
  current: v.boolean(),
});

export const apiTokenSchema = v.object({
  id: idSchema,
  name: v.string(),
  kind: tokenKindSchema,
  role: roleSchema,
  project_ids: v.nullable(v.array(idSchema)),
  prefix: v.string(),
  created_by: v.nullable(idSchema),
  created_at: timestampSchema,
  last_used_at: v.nullable(timestampSchema),
  expires_at: v.nullable(timestampSchema),
  revoked_at: v.nullable(timestampSchema),
});
export type ApiToken = v.InferOutput<typeof apiTokenSchema>;

export const createTokenSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
    kind: v.optional(tokenKindSchema, "standard"),
    role: v.optional(roleSchema),
    project_ids: v.optional(v.nullable(v.array(idSchema)), null),
    expires_at: v.optional(timestampSchema),
  }),
  v.check(
    (input) => input.kind !== "agent" || input.role === undefined,
    "agent tokens are always viewer"
  ),
  v.check((input) => input.kind === "agent" || input.role !== undefined, "role is required")
);

export const createTokenResponseSchema = v.object({
  token: v.pipe(v.string(), v.startsWith("tst_")),
  record: apiTokenSchema,
});
