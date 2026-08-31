import * as v from "valibot";
import type { JsonObject, Project } from "@testate/shared";
import { idSchema, jobSchema, projectSchema, quotaSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const path = (slug: string): string => `/projects/${encodeURIComponent(slug)}`;

const affectedSchema = v.object({
  adapters: v.number(),
  states: v.number(),
  protected_states: v.number(),
  checkouts: v.number(),
  diffs: v.number(),
  import_runs: v.number(),
  saved_queries: v.number(),
  tokens: v.number(),
});

export type DeletionAffected = v.InferOutput<typeof affectedSchema>;

export const deletionPlanSchema = v.object({
  plan_id: idSchema,
  expires_at: v.string(),
  protected_states: v.number(),
  affected: affectedSchema,
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

const headBannerSchema = v.nullable(
  v.object({ kind: v.literal("head_unknown"), message: v.string() })
);
export type HeadBanner = v.InferOutput<typeof headBannerSchema>;

const overviewSchema = v.object({
  project: projectSchema,
  quota: quotaSchema,
  banner: headBannerSchema,
});
export type Overview = v.InferOutput<typeof overviewSchema>;

export const projectsModel = {
  list: (): Promise<Project[]> => apiClient.get("/projects", { schema: v.array(projectSchema) }),
  page: (cursor?: string): Promise<{ data: Project[]; next: string | null }> =>
    apiClient.page("/projects", projectSchema, cursor === undefined ? undefined : { cursor }),
  /** One request for the project, its quota and the "why" behind an unknown HEAD, not three. */
  overview: (slug: string): Promise<Overview> =>
    apiClient.get(path(slug), { schema: overviewSchema }),
  create: (body: { slug: string; name: string }): Promise<Project> =>
    apiClient.post("/projects", { schema: projectSchema, body }),
  update: (slug: string, body: JsonObject): Promise<Project> =>
    apiClient.patch(path(slug), { schema: projectSchema, body }),
  deletionPlan: (slug: string): Promise<DeletionPlan> =>
    apiClient.get(`${path(slug)}/deletion-plan`, { schema: deletionPlanSchema }),
  deleteProject: (slug: string, body: JsonObject): Promise<Job> =>
    apiClient.post(`${path(slug)}/deletion`, { schema: jobSchema, body }),
};
