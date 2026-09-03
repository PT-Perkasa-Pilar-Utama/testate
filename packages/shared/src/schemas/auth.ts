import * as v from "valibot";

import { roleSchema, tokenKindSchema } from "../enums.ts";
import { actorSchema, idSchema, timestampSchema } from "./common.ts";

export const PASSWORD_MIN_LENGTH = 12;

/**
 * The passwords a first guess tries, twelve characters or longer (the floor rejects the rest):
 * the top of every breach list. Not a breach lookup, which an offline instance cannot make, but
 * the part of one that catches most of what the lookup would (ASVS 2.1.7).
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password1234",
  "password12345",
  "password123456",
  "passwordpassword",
  "123456789012",
  "1234567890123",
  "12345678901234",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwerty123456",
  "iloveyou1234",
  "administrator",
  "adminadmin123",
  "letmein12345",
  "welcome12345",
  "welcome123456",
  "changeme1234",
  "change-me-now-1234",
  "trustno1trustno1",
  "abcdefghijkl",
  "abc123abc123",
  "111111111111",
  "000000000000",
  "aaaaaaaaaaaa",
  "monkey123456",
  "dragon123456",
  "football1234",
  "baseball1234",
  "sunshine1234",
  "princess1234",
  "superman1234",
  "michael12345",
  "computer1234",
  "internet1234",
  "testate12345",
  "testtesttest",
  "passw0rd1234",
  "p@ssword1234",
  "p@ssw0rd1234",
  "secret123456",
]);

/**
 * A password nobody should be able to keep: on the common list. The username is deliberately not
 * a rule: the bootstrap account is called `admin`, and refusing every password with that word in
 * it would refuse the one an operator put in `TESTATE_ADMIN_PASSWORD` the moment they tried to
 * set it back.
 */
export function passwordWeakness(next: string): string | null {
  return COMMON_PASSWORDS.has(next.toLowerCase())
    ? "That password is on every guess list. Choose another."
    : null;
}

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
      v.maxLength(1024, "That password is too long to be one of ours."),
      v.check(
        (next) => !COMMON_PASSWORDS.has(next.toLowerCase()),
        "That password is on every guess list. Choose another."
      )
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

/** When a token stops working, as one answer rather than a date that may or may not be filled in. */
export const TOKEN_EXPIRIES = ["default", "date", "none"] as const;
export const tokenExpirySchema = v.picklist(TOKEN_EXPIRIES);
export type TokenExpiry = v.InferOutput<typeof tokenExpirySchema>;

// The "New API token" dialog's own shape, not the wire body: it picks when the token expires and,
// for the one answer that needs it, a plain calendar date. `toCreateBody` in the tokens presenter
// turns that into the `createTokenSchema` body the API expects - reusing `createTokenSchema`
// directly here would mean binding a date input to a field that must already be an ISO timestamp.
export const tokenDraftSchema = v.object({
  name: v.pipe(
    v.string(),
    v.minLength(1, "Enter a name."),
    v.maxLength(80, "A name is at most 80 characters.")
  ),
  kind: tokenKindSchema,
  role: roleSchema,
  expiry: tokenExpirySchema,
  expires_on: v.string(),
});
export type TokenDraft = v.InferOutput<typeof tokenDraftSchema>;
