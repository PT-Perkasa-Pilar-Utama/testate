import type { AdapterKind, AdapterWithProject } from "@testate/shared";

import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { toPublic } from "./adapters.helpers.ts";
import type { AdapterRecord } from "./adapters.repository.ts";

/**
 * Every adapter of one kind across the projects a caller may see.
 *
 * A file store is not a project primitive: it never enters a state and never gets checked out
 *, so its screen lists the whole instance and names the owning project on
 * each row. The scope is still the caller's, so a project-scoped token sees only its own.
 */
export function listByKind(
  all: readonly AdapterRecord[],
  projects: Pick<ProjectsRepository, "byId">,
  scope: string[] | null,
  kind: AdapterKind
): AdapterWithProject[] {
  const rows: AdapterWithProject[] = [];
  for (const adapter of all) {
    if (adapter.kind !== kind) continue;
    if (scope !== null && !scope.includes(adapter.project_id)) continue;
    const project = projects.byId(adapter.project_id);
    if (project === null) continue;
    rows.push({ ...toPublic(adapter), project_slug: project.slug, project_name: project.name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
