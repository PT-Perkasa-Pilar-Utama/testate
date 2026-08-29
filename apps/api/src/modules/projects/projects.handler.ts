import { createProjectSchema, idSchema, updateProjectSchema } from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { ProjectPatch, ProjectsListQuery } from "./projects.repository.ts";
import { respondWithJob } from "../jobs/jobs.handler.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { CreateProjectInput, ProjectsService } from "./projects.service.ts";

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

const listQuery = v.object({
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  sort: v.optional(v.array(v.picklist(["name", "created_at"]))),
  order: v.optional(v.array(v.picklist(["asc", "desc"]))),
  q: v.optional(v.array(v.string())),
});

const deletionSchema = v.object({
  confirm_slug: v.string(),
  plan_id: idSchema,
  adapters: v.array(
    v.object({ adapter_id: idSchema, action: v.picklist(["restore", "force", "skip"]) })
  ),
});

export function toListQuery(
  parsed: v.InferOutput<typeof listQuery>
): Omit<ProjectsListQuery, "ids"> {
  const query: Omit<ProjectsListQuery, "ids"> = {
    limit: firstQuery(parsed.limit) ?? 50,
    sort: firstQuery(parsed.sort) ?? "name",
    order: firstQuery(parsed.order) ?? "asc",
  };
  const q = firstQuery(parsed.q);
  if (q !== undefined) query.q = q;
  return query;
}

/** Drops undefined optional fields so the inputs match exactOptionalPropertyTypes. */
function toCreateInput(parsed: v.InferOutput<typeof createProjectSchema>): CreateProjectInput {
  const input: CreateProjectInput = { slug: parsed.slug, name: parsed.name };
  if (parsed.description !== undefined) input.description = parsed.description;
  return input;
}

function toPatch(parsed: v.InferOutput<typeof updateProjectSchema>): ProjectPatch {
  const patch: ProjectPatch = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.description !== undefined) patch.description = parsed.description;
  if (parsed.quota_bytes !== undefined) patch.quota_bytes = parsed.quota_bytes;
  return patch;
}

export function createProjectsHandlers(
  service: ProjectsService,
  apiPrefix: string,
  trustProxy: boolean,
  jobs: JobsService
): ProjectsHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    list: async (c) => {
      const query = toListQuery(parseQuery(c, listQuery));
      return okPage(c, await service.list(c.get("projectScope"), query), null, query.limit);
    },
    create: async (c) => {
      const input = toCreateInput(await parseBody(c, createProjectSchema));
      return ok(c, await service.create(currentActor(c), input, meta(c)), 201);
    },
    get: async (c) => ok(c, await service.get(currentActor(c), param(c, "slug"))),
    update: async (c) => {
      const patch = toPatch(await parseBody(c, updateProjectSchema));
      return ok(c, await service.update(currentActor(c), param(c, "slug"), patch, meta(c)));
    },
    head: async (c) => ok(c, await service.head(param(c, "slug"))),
    quota: async (c) => ok(c, await service.quota(param(c, "slug"))),
    deletionPlan: async (c) => ok(c, await service.deletionPlan(param(c, "slug"))),
    deleteProject: async (c) => {
      const input = await parseBody(c, deletionSchema);
      const job = await service.deleteProject(currentActor(c), param(c, "slug"), input, meta(c));
      return respondWithJob(c, job, jobs, apiPrefix);
    },
  };
}
