import * as v from "valibot";
import type { JsonObject, Project, ProjectDefaults } from "@testate/shared";
import {
  idSchema,
  jobSchema,
  projectDefaultsSchema,
  projectSchema,
  quotaSchema,
} from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import { tableQuery } from "@/lib/table.ts";
import type { TableParams } from "@/lib/table.ts";
import type { ProjectSort } from "./projects.presenter.ts";

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
  /** Only the count is read, on the Inspect card. */
  adapters: v.array(v.object({ id: idSchema })),
  quota: quotaSchema,
  banner: headBannerSchema,
});
export type Overview = v.InferOutput<typeof overviewSchema>;

export const projectsModel = {
  list: (): Promise<Project[]> => apiClient.get("/projects", { schema: v.array(projectSchema) }),
  /** Every project a scope picker offers, by name. */
  // ponytail: one page of 200, the API's cap. Past that the picker misses projects; page through
  // with `apiClient.page` or add a search box.
  choices: (): Promise<Project[]> =>
    apiClient.get("/projects", {
      schema: v.array(projectSchema),
      query: { limit: 200, sort: "name", order: "asc" },
    }),
  /** The projects table: people's projects only; Inspect is its own card above it (#56, Q8). */
  page: (cursor: string | undefined, params: TableParams<ProjectSort>): Promise<Page<Project>> =>
    apiClient.page("/projects", projectSchema, { ...tableQuery(params, cursor), kind: "standard" }),
  /** The built-in Inspect project, or null when the caller's scope leaves it out. */
  inspect: async (): Promise<Project | null> => {
    const found = await apiClient.get("/projects", {
      schema: v.array(projectSchema),
      query: { kind: "inspect", limit: 1 },
    });
    return found[0] ?? null;
  },
  /** The Inspect project with its adapters, for its card; null when the scope leaves it out. */
  inspectOverview: async (): Promise<Overview | null> => {
    const inspect = await projectsModel.inspect();
    return inspect === null ? null : projectsModel.overview(inspect.slug);
  },
  /** One request for the project, its quota and the "why" behind an unknown HEAD, not three. */
  overview: (slug: string): Promise<Overview> =>
    apiClient.get(path(slug), { schema: overviewSchema }),
  create: (body: JsonObject): Promise<Project> =>
    apiClient.post("/projects", { schema: projectSchema, body }),
  defaults: (): Promise<ProjectDefaults> =>
    apiClient.get("/projects/defaults", { schema: projectDefaultsSchema }),
  update: (slug: string, body: JsonObject): Promise<Project> =>
    apiClient.patch(path(slug), { schema: projectSchema, body }),
  deletionPlan: (slug: string): Promise<DeletionPlan> =>
    apiClient.get(`${path(slug)}/deletion-plan`, { schema: deletionPlanSchema }),
  deleteProject: (slug: string, body: JsonObject): Promise<Job> =>
    apiClient.post(`${path(slug)}/deletion`, { schema: jobSchema, body }),
};
