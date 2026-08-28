import { createProjectSchema, idSchema, updateProjectSchema } from "@testate/shared";
import * as v from "valibot";

import { accepted, ok, okPage, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { ProjectsService } from "./projects.service.ts";

export type ProjectsHandlers = {
  list: Handler;
  create: Handler;
  get: Handler;
  update: Handler;
  head: Handler;
  quota: Handler;
  deletionPlan: Handler;
  deleteProject: Handler;
};

const deletionSchema = v.object({
  confirm_slug: v.string(),
  plan_id: idSchema,
  adapters: v.array(
    v.object({ adapter_id: idSchema, action: v.picklist(["restore", "force", "skip"]) })
  ),
});

export function createProjectsHandlers(
  service: ProjectsService,
  apiPrefix: string
): ProjectsHandlers {
  return {
    list: async (c) => okPage(c, await service.list(), null, 50),
    create: async (c) => {
      const input = await parseBody(c, createProjectSchema);
      return ok(c, await service.create(input.slug), 201);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"))),
    update: async (c) => {
      await parseBody(c, updateProjectSchema);
      return ok(c, await service.update(param(c, "slug")));
    },
    head: async (c) => ok(c, await service.head(param(c, "slug"))),
    quota: async (c) => ok(c, await service.quota(param(c, "slug"))),
    deletionPlan: async (c) => ok(c, await service.deletionPlan(param(c, "slug"))),
    deleteProject: async (c) => {
      const input = await parseBody(c, deletionSchema);
      const job = await service.deleteProject(param(c, "slug"), input.confirm_slug, input.plan_id);
      return accepted(c, job, apiPrefix);
    },
  };
}
