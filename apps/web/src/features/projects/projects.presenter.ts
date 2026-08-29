import { createSignal } from "solid-js";
import type { Project } from "@testate/shared";

import { createPaged } from "@/lib/async.ts";
import type { Paged } from "@/lib/async.ts";
import { projectsModel } from "./projects.model.ts";

export type ProjectsPresenter = Paged<Project> & {
  creating: () => boolean;
  name: () => string;
  slug: () => string;
  error: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  setName: (value: string) => void;
  setSlug: (value: string) => void;
  create: () => Promise<void>;
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
  const [creating, setCreating] = createSignal(false);
  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [slugTouched, setSlugTouched] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  return {
    ...projects,
    creating,
    name,
    slug,
    error,
    openCreate: () => setCreating(true),
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    setName: (value) => {
      setName(value);
      if (!slugTouched()) setSlug(slugify(value));
    },
    setSlug: (value) => {
      setSlugTouched(true);
      setSlug(value);
    },
    create: async () => {
      setError(null);
      try {
        await projectsModel.create({ name: name().trim(), slug: slug() });
        setCreating(false);
        setName("");
        setSlug("");
        setSlugTouched(false);
        projects.refresh();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "could not create the project");
      }
    },
  };
}
