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
    current: v.pipe(v.string(), v.minLength(1, "Enter your current password.")),
    next: v.pipe(
      v.string(),
      v.minLength(
        PASSWORD_MIN_LENGTH,
        `A new password needs at least ${PASSWORD_MIN_LENGTH} characters.`
      ),
      v.maxLength(1024, "That password is too long to be one of ours.")
    ),
  }),
  // Forwarded to "next" so the message lands under the field a person needs to change, rather
  // than a form-level error nothing in this app's markup ever displays.
  v.forward(
    v.check(
      (input) => input.current !== input.next,
      "Choose a password that differs from the current one."
    ),
    ["next"]
  )
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

// `expires_at: null` is a token that never expires, and it is a different thing from the field
// being absent, which still takes the ninety-day default an agent token has always had.
export const createTokenSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
    kind: v.optional(tokenKindSchema, "standard"),
    role: v.optional(roleSchema),
    project_ids: v.optional(v.nullable(v.array(idSchema)), null),
    expires_at: v.optional(v.nullable(timestampSchema)),
  }),
  // An agent reads and now also writes, but it never administers: no agent token can create
  // another token, change a setting, or delete a user (23 §23.6).
  v.check(
    (input) => input.kind !== "agent" || input.role !== "admin",
    "an agent token is a viewer or a tester"
  ),
  v.check((input) => input.kind === "agent" || input.role !== undefined, "role is required")
);

export const createTokenResponseSchema = v.object({
  token: v.pipe(v.string(), v.startsWith("tst_")),
  record: apiTokenSchema,
});

// The "New API token" dialog's own shape, not the wire body: it picks a plain calendar date
// ("expires_on") and a "never" switch. `toCreateBody` in the tokens presenter turns this into the
// `createTokenSchema` body the API expects (an ISO timestamp, or null for never) - reusing
// `createTokenSchema` directly here would mean binding a date input to a field that must already
// be a full ISO timestamp.
export const tokenDraftSchema = v.object({
  name: v.pipe(
    v.string(),
    v.minLength(1, "Enter a name."),
    v.maxLength(80, "A name is at most 80 characters.")
  ),
  kind: tokenKindSchema,
  role: roleSchema,
  expires_on: v.string(),
  never_expires: v.boolean(),
});
export type TokenDraft = v.InferOutput<typeof tokenDraftSchema>;
