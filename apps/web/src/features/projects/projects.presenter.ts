import { createSignal } from "solid-js";
import type { CreateProjectInput, Project } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createPaged } from "@/lib/async.ts";
import { createTableView } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Paged } from "@/lib/async.ts";
import { projectsModel } from "./projects.model.ts";

/**
 * The form holds the two fields, validates them against `createProjectSchema`, and derives the
 * slug from the name until the slug is edited directly (see the view); this holds only what the
 * server can answer, such as a slug already taken.
 */
export type ProjectSort = "name" | "changed_at";

export type ProjectsPresenter = Paged<Project> & {
  table: TableView<Project, ProjectSort>;
  creating: () => boolean;
  error: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  submit: (input: CreateProjectInput) => Promise<void>;
};

/** Lowercase, digits, and single dashes: the same rule as `slugSchema`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function createProjectsPresenter(): ProjectsPresenter {
  const projects = createPaged((cursor) => projectsModel.page(cursor));
  const table = createTableView<Project, ProjectSort>({
    rows: () => projects.value(),
    sorters: {
      name: { text: (project) => project.name },
      changed_at: { text: (project) => project.head.changed_at },
    },
    fields: (project) => [project.name, project.slug],
    pager: { hasMore: projects.hasMore, loadMore: projects.loadMore },
  });
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  return {
    ...projects,
    table,
    creating,
    error,
    openCreate: () => setCreating(true),
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    submit: async (input) => {
      setError(null);
      try {
        await projectsModel.create({ slug: input.slug, name: input.name.trim() });
        setCreating(false);
        projects.refresh();
      } catch (cause: unknown) {
        setError(humanMessage(cause, "Could not create the project."));
      }
    },
  };
}
