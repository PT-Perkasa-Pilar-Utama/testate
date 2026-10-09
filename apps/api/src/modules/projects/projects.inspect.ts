import { INSPECT_SLUG, freeSlug } from "@testate/shared";

import type { ProjectsRepository } from "./projects.repository.ts";

/** What a person reads under the Inspect project's name. */
export const INSPECT_DESCRIPTION =
  "Read-only connections, for looking and for agents. Testate never writes here: no states, no checkouts, no imports.";

/**
 * Makes sure the built-in Inspect project exists (#56, Q2). Boot and reset-state call it right
 * after the bootstrap admin, because `projects.created_by` must name a user and the migrations run
 * before there is one. It finds the row by kind, never by slug: an install that already had its
 * own `inspect` project keeps it, and Inspect takes `inspect-2`. Returns whether it created one.
 */
export function ensureInspectProject(
  repo: Pick<ProjectsRepository, "byKind" | "bySlug" | "insert">,
  firstAdminId: () => string | null,
  now: () => Date
): boolean {
  if (repo.byKind("inspect") !== null) return false;
  const creator = firstAdminId();
  // No admin yet means no bootstrap ran; the next boot or reset that has one creates it.
  if (creator === null) return false;
  const taken = (slug: string): boolean => repo.bySlug(slug) !== null;
  repo.insert({
    id: Bun.randomUUIDv7(),
    slug: taken(INSPECT_SLUG) ? freeSlug(INSPECT_SLUG, taken) : INSPECT_SLUG,
    kind: "inspect",
    name: "Inspect",
    description: INSPECT_DESCRIPTION,
    quota_bytes: null,
    created_by: creator,
    created_at: now().toISOString(),
  });
  return true;
}
