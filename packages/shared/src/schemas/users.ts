import * as v from "valibot";

import { roleSchema } from "../enums.ts";
import { PASSWORD_MIN_LENGTH } from "./auth.ts";
import { idSchema, timestampSchema } from "./common.ts";

export const usernameSchema = v.pipe(v.string(), v.regex(/^[a-z0-9._-]{3,64}$/));

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
  display_name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  role: roleSchema,
  temporary_password: v.pipe(v.string(), v.minLength(PASSWORD_MIN_LENGTH), v.maxLength(1024)),
});

export const updateUserSchema = v.object({
  display_name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  role: v.optional(roleSchema),
});

export const resetPasswordSchema = v.object({
  temporary_password: v.pipe(v.string(), v.minLength(PASSWORD_MIN_LENGTH), v.maxLength(1024)),
});
