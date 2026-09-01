import * as v from "valibot";

import { roleSchema } from "../enums.ts";
import { PASSWORD_MIN_LENGTH } from "./auth.ts";
import { idSchema, timestampSchema } from "./common.ts";

// The messages are the ones a person reads, on the users forms and in the API's 400 alike (see
// `loginSchema` in auth.ts for the same convention).
export const usernameSchema = v.pipe(
  v.string(),
  v.regex(
    /^[a-z0-9._-]{3,64}$/,
    "Lowercase letters, numbers, dots, underscores or hyphens, 3 to 64 characters."
  )
);

export const userSchema = v.object({
  id: idSchema,
  username: usernameSchema,
  display_name: v.string(),
  role: roleSchema,
  must_change_password: v.boolean(),
  disabled_at: v.nullable(timestampSchema),
  locked_until: v.nullable(timestampSchema),
  last_login_at: v.nullable(timestampSchema),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type User = v.InferOutput<typeof userSchema>;

export const createUserSchema = v.object({
  username: usernameSchema,
  display_name: v.pipe(
    v.string(),
    v.minLength(1, "Enter a display name."),
    v.maxLength(120, "A display name is at most 120 characters.")
  ),
  role: roleSchema,
  temporary_password: v.pipe(
    v.string(),
    v.minLength(
      PASSWORD_MIN_LENGTH,
      `A temporary password needs at least ${PASSWORD_MIN_LENGTH} characters.`
    ),
    v.maxLength(1024, "That password is too long to be one of ours.")
  ),
});
export type CreateUserInput = v.InferOutput<typeof createUserSchema>;

export const updateUserSchema = v.object({
  display_name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  role: v.optional(roleSchema),
});

/**
 * What the edit dialog carries. `updateUserSchema` is the wire shape, where either field may be
 * left out; the form always shows both, so both are stated here and neither is optional.
 */
export const editUserFormSchema = v.object({
  display_name: v.pipe(
    v.string(),
    v.minLength(1, "A display name cannot be empty."),
    v.maxLength(120, "A display name is at most 120 characters.")
  ),
  role: roleSchema,
});
export type EditUserInput = v.InferOutput<typeof editUserFormSchema>;

export const resetPasswordSchema = v.object({
  temporary_password: v.pipe(
    v.string(),
    v.minLength(
      PASSWORD_MIN_LENGTH,
      `A temporary password needs at least ${PASSWORD_MIN_LENGTH} characters.`
    ),
    v.maxLength(1024, "That password is too long to be one of ours.")
  ),
});
export type ResetPasswordInput = v.InferOutput<typeof resetPasswordSchema>;
