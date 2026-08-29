import * as v from "valibot";
import type { JsonObject, Project, Quota } from "@testate/shared";
import { idSchema, jobSchema, projectSchema, quotaSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const path = (slug: string): string => `/projects/${encodeURIComponent(slug)}`;

export const deletionPlanSchema = v.object({
  plan_id: idSchema,
  expires_at: v.string(),
  protected_states: v.number(),
  adapters: v.array(
    v.object({
      adapter_id: idSchema,
      name: v.string(),
      engine: v.string(),
      init_state_id: v.nullable(idSchema),
      action: v.picklist(["restore", "force", "skip", "none"]),
      reason: v.optional(v.string()),
    })
  ),
});
export type DeletionPlan = v.InferOutput<typeof deletionPlanSchema>;
export type Job = v.InferOutput<typeof jobSchema>;

export const projectsModel = {
  list: (): Promise<Project[]> => apiClient.get("/projects", { schema: v.array(projectSchema) }),
  page: (cursor?: string): Promise<{ data: Project[]; next: string | null }> =>
    apiClient.page("/projects", projectSchema, cursor === undefined ? undefined : { cursor }),
  get: async (slug: string): Promise<Project> => {
    const overview = await apiClient.get(path(slug), {
      schema: v.object({ project: projectSchema }),
    });
    return overview.project;
  },
  quota: (slug: string): Promise<Quota> =>
    apiClient.get(`${path(slug)}/quota`, { schema: quotaSchema }),
  create: (body: { slug: string; name: string }): Promise<Project> =>
    apiClient.post("/projects", { schema: projectSchema, body }),
  update: (slug: string, body: JsonObject): Promise<Project> =>
    apiClient.patch(path(slug), { schema: projectSchema, body }),
  deletionPlan: (slug: string): Promise<DeletionPlan> =>
    apiClient.get(`${path(slug)}/deletion-plan`, { schema: deletionPlanSchema }),
  deleteProject: (slug: string, body: JsonObject): Promise<Job> =>
    apiClient.post(`${path(slug)}/deletion`, { schema: jobSchema, body }),
};
