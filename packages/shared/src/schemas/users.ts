import * as v from "valibot";

import { roleSchema } from "../enums.ts";
import { COMMON_PASSWORDS, PASSWORD_MIN_LENGTH } from "./auth.ts";
import { idSchema, timestampSchema } from "./common.ts";
import { CHOOSE_SCOPE, scopeChoiceSchema } from "./scope.ts";

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
  /**
   * The projects this user may see and act on: a list, possibly empty, or `null` for every project.
   * Always `null` for an admin, who has every project (#55, docs/decisions/2026-10-09-project-scope.md).
   */
  project_ids: v.nullable(v.array(idSchema)),
});
export type User = v.InferOutput<typeof userSchema>;

const projectIdsSchema = v.nullable(v.array(idSchema));

/** What every new account states, on the wire and in the form alike. */
const newUserEntries = {
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
    v.maxLength(1024, "A password has at most 1024 characters."),
    v.check(
      (next) => !COMMON_PASSWORDS.has(next.toLowerCase()),
      "That password is on every guess list. Choose another."
    )
  ),
};

// A viewer or a tester states which projects they get: every project (`null`) or a list. Nothing
// picks for them, so a new account never reaches a project nobody chose (Q3). An admin always has
// every project, so for an admin the field is not needed and is ignored.
export const createUserSchema = v.pipe(
  v.object({ ...newUserEntries, project_ids: v.optional(projectIdsSchema) }),
  v.check(
    (input) => input.role === "admin" || input.project_ids !== undefined,
    "Choose the projects this user can see, or every project."
  )
);
export type CreateUserInput = v.InferOutput<typeof createUserSchema>;

export const updateUserSchema = v.object({
  display_name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  role: v.optional(roleSchema),
  /** Replaces the scope when present. Required when an admin becomes a viewer or a tester (Q9). */
  project_ids: v.optional(projectIdsSchema),
});

/**
 * What the edit dialog carries. `updateUserSchema` is the wire shape, where any field may be left
 * out; the form always shows the name and the role, so both are stated here.
 */
/**
 * The scope part of the user forms (#55). A viewer or a tester answers it; an admin has every
 * project and never sees it. The choice starts empty and the form refuses until it is made, and a
 * pick of no projects is allowed (Q7): a new hire may wait for access.
 */
const userScopeEntries = { scope: v.optional(scopeChoiceSchema), project_ids: v.array(idSchema) };
const scopeStated = (input: { role: string; scope?: string | undefined }): boolean =>
  input.role === "admin" || input.scope !== undefined;

/** The "New user" dialog's shape; the presenter turns its scope into `project_ids`. */
export const userDraftSchema = v.pipe(
  v.object({ ...newUserEntries, ...userScopeEntries }),
  v.forward(
    v.check((input) => scopeStated(input), CHOOSE_SCOPE),
    ["scope"]
  )
);
export type UserDraft = v.InferOutput<typeof userDraftSchema>;

export const editUserFormSchema = v.pipe(
  v.object({
    display_name: v.pipe(
      v.string(),
      v.minLength(1, "A display name cannot be empty."),
      v.maxLength(120, "A display name is at most 120 characters.")
    ),
    role: roleSchema,
    ...userScopeEntries,
  }),
  // Demoting an admin asks the question afresh (Q9): the form starts with no scope for an admin.
  v.forward(
    v.check((input) => scopeStated(input), CHOOSE_SCOPE),
    ["scope"]
  )
);
export type EditUserInput = v.InferOutput<typeof editUserFormSchema>;

export const resetPasswordSchema = v.object({
  temporary_password: v.pipe(
    v.string(),
    v.minLength(
      PASSWORD_MIN_LENGTH,
      `A temporary password needs at least ${PASSWORD_MIN_LENGTH} characters.`
    ),
    v.maxLength(1024, "A password has at most 1024 characters."),
    v.check(
      (next) => !COMMON_PASSWORDS.has(next.toLowerCase()),
      "That password is on every guess list. Choose another."
    )
  ),
});
export type ResetPasswordInput = v.InferOutput<typeof resetPasswordSchema>;
