import * as v from "valibot";

import { idSchema } from "./common.ts";

/**
 * How a form asks which projects a token or a user reaches (#55,
 * docs/decisions/2026-10-09-project-scope.md). The wire value is `project_ids`: `null` for every
 * project, or a list. A form asks the question in two parts, every project or a pick, because a
 * `null` cannot sit behind a control, and because neither answer may be the default: the choice
 * starts empty and the form refuses until someone makes it.
 */
export const SCOPE_CHOICES = ["all", "chosen"] as const;
export const scopeChoiceSchema = v.picklist(
  SCOPE_CHOICES,
  "Choose every project, or pick the projects."
);
export type ScopeChoice = v.InferOutput<typeof scopeChoiceSchema>;

/** The two scope fields every form that sets a scope carries, merged into its own object schema. */
export const scopeFormEntries = {
  scope: scopeChoiceSchema,
  project_ids: v.array(idSchema),
};

/**
 * A pick of no projects is refused where an empty scope would be useless: a token that reaches
 * nothing. A user may be given none yet (Q7), so the user forms do not add this check.
 */
export const PICK_AT_LEAST_ONE = "Pick at least one project, or choose every project.";

/** The wire `project_ids` for what a form chose. */
export function projectIdsOf(scope: ScopeChoice, picked: readonly string[]): string[] | null {
  return scope === "all" ? null : [...picked];
}

/** The form's two fields for a scope already stored, to prefill an edit. */
export function scopeFieldsOf(projectIds: readonly string[] | null): {
  scope: ScopeChoice;
  project_ids: string[];
} {
  return projectIds === null
    ? { scope: "all", project_ids: [] }
    : { scope: "chosen", project_ids: [...projectIds] };
}
