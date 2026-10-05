import type { Project } from "@testate/shared";

import { notFound } from "../../lib/http/index.ts";
import type { AdapterRecord } from "./adapters.repository.ts";

export function assertAdapterInProject(
  projectOf: (slug: string) => Project,
  byId: (adapterId: string) => AdapterRecord | null
): (projectSlug: string, adapterId: string) => void {
  return (projectSlug, adapterId) => {
    const project = projectOf(projectSlug);
    const adapter = byId(adapterId);
    if (adapter === null || adapter.project_id !== project.id) throw notFound("adapter");
  };
}
