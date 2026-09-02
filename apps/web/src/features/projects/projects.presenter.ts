import { createSignal } from "solid-js";
import { showToast } from "@/lib/toast.ts";
import type { CreateProjectInput, JsonObject, Project, ProjectDefaults } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createPaged, createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { createTableControls } from "@/lib/table.ts";
import type { TableControls } from "@/lib/table.ts";
import type { Paged } from "@/lib/async.ts";
import { projectsModel } from "./projects.model.ts";

/**
 * The form holds the name and the description and validates them against `createProjectSchema`;
 * this holds the quota, which is a slider rather than a field, and what only the server can
 * answer, such as a slug already taken.
 */
export type ProjectSort = "name" | "changed_at" | "created_at" | "updated_at";

export type ProjectsPresenter = Paged<Project> & {
  /** Sort, search and the created-date range, all performed by the API. */
  table: TableControls<ProjectSort> & { rows: () => Project[] };
  creating: () => boolean;
  error: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  submit: (input: CreateProjectInput) => Promise<void>;
  /** What a project inherits when it names no quota; the slider labels its first step with it. */
  defaults: Refreshable<ProjectDefaults>;
  quotaIndex: () => number;
  setQuotaIndex: (index: number) => void;
};

const GIB = 1024 ** 3;

/**
 * The quota ladder, in the order the slider walks it: inherit, then sizes, then no limit at all.
 * `null` keeps the project on the instance default, so an admin raising that later moves this
 * project with it; a number pins it. Zero means no quota, which is what the API already reads it as.
 */
export const QUOTA_STEPS: readonly (number | null)[] = [
  null,
  1 * GIB,
  5 * GIB,
  10 * GIB,
  25 * GIB,
  50 * GIB,
  100 * GIB,
  250 * GIB,
  500 * GIB,
  0,
];

/** The step a stored quota sits on, or the nearest one above it for a value set by hand. */
export function quotaIndex(bytes: number | null): number {
  if (bytes === null) return 0;
  if (bytes === 0) return QUOTA_STEPS.length - 1;
  const found = QUOTA_STEPS.findIndex((step) => step !== null && step >= bytes);
  return found === -1 ? QUOTA_STEPS.length - 2 : found;
}

export function createProjectsPresenter(): ProjectsPresenter {
  const controls = createTableControls<ProjectSort>();
  const projects = createPaged(
    (cursor) => projectsModel.page(cursor, controls.params()),
    controls.key
  );
  const table: TableControls<ProjectSort> & { rows: () => Project[] } = {
    ...controls,
    rows: projects.value,
  };
  const defaults = createRefreshable(() => projectsModel.defaults());
  const [quota, setQuota] = createSignal(0);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  return {
    ...projects,
    table,
    creating,
    error,
    defaults,
    quotaIndex: quota,
    setQuotaIndex: setQuota,
    openCreate: () => {
      setQuota(0);
      setCreating(true);
    },
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    submit: async (input) => {
      setError(null);
      try {
        // No slug: the dialog shows what the name would become, and the API decides the one that is
        // free. Sending the preview would turn a second project of the same name into a 409.
        const body: JsonObject = {
          name: input.name.trim(),
          quota_bytes: QUOTA_STEPS[quota()] ?? null,
        };
        const description = input.description?.trim() ?? "";
        if (description !== "") body["description"] = description;
        await projectsModel.create(body);
        showToast("Project created.", "success");
        setCreating(false);
        projects.refresh();
      } catch (cause: unknown) {
        setError(humanMessage(cause, "Could not create the project."));
      }
    },
  };
}
