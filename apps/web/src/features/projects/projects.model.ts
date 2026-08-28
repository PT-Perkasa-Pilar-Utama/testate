import * as v from "valibot";
import type { Project, Quota } from "@testate/shared";
import { projectSchema, quotaSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const projectsModel = {
  list: (): Promise<Project[]> => apiClient.get("/projects", { schema: v.array(projectSchema) }),
  get: (slug: string): Promise<Project> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}`, { schema: projectSchema }),
  quota: (slug: string): Promise<Quota> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/quota`, { schema: quotaSchema }),
  create: (body: { slug: string; name: string }): Promise<Project> =>
    apiClient.post("/projects", { schema: projectSchema, body }),
};
