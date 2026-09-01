import { suggestHosts } from "./adapters.hosts.ts";
import {
  adapterDeletionSchema,
  adapterDraftSchema,
  adapterKindSchema,
  adapterPatchSchema,
  adapterStatusSchema,
  engineSchema,
  setModeSchema,
} from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import { respondWithJob } from "../jobs/jobs.handler.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { AdaptersFilter } from "./adapters.repository.ts";
import type { AdapterPatch, AdaptersService } from "./adapters.service.ts";

export type AdaptersHandlers = {
  hosts: Handler;
  stores: Handler;
  list: Handler;
  testDraft: Handler;
  create: Handler;
  get: Handler;
  update: Handler;
  setMode: Handler;
  retest: Handler;
  deletionPlan: Handler;
  remove: Handler;
};

const listQuery = v.object({
  kind: v.optional(v.array(adapterKindSchema)),
  engine: v.optional(v.array(engineSchema)),
  status: v.optional(v.array(adapterStatusSchema)),
});

function toFilter(parsed: v.InferOutput<typeof listQuery>): AdaptersFilter {
  const filter: AdaptersFilter = {};
  const kind = firstQuery(parsed.kind);
  if (kind !== undefined) filter.kind = kind;
  const engine = firstQuery(parsed.engine);
  if (engine !== undefined) filter.engine = engine;
  const status = firstQuery(parsed.status);
  if (status !== undefined) filter.status = status;
  return filter;
}

/** Drops undefined optional fields so the patch matches exactOptionalPropertyTypes. */
export function toPatch(parsed: v.InferOutput<typeof adapterPatchSchema>): AdapterPatch {
  const patch: AdapterPatch = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.config !== undefined) patch.config = parsed.config;
  if (parsed.secrets !== undefined) patch.secrets = parsed.secrets;
  if (parsed.readonly_secrets !== undefined) patch.readonly_secrets = parsed.readonly_secrets;
  if (parsed.excluded_tables !== undefined) patch.excluded_tables = parsed.excluded_tables;
  if (parsed.restore_mode !== undefined) patch.restore_mode = parsed.restore_mode;
  if (parsed.lock_timeout_ms !== undefined) patch.lock_timeout_ms = parsed.lock_timeout_ms;
  return patch;
}

export function createAdaptersHandlers(
  service: AdaptersService,
  apiPrefix: string,
  trustProxy: boolean,
  jobs: JobsService
): AdaptersHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    list: async (c) => {
      const rows = await service.list(param(c, "slug"), toFilter(parseQuery(c, listQuery)));
      return okPage(c, rows, null, 50);
    },
    /** Not project-scoped: it describes the server, not anything inside a project. */
    hosts: async (c) => ok(c, await suggestHosts()),
    /** Across projects, because a file store is not a project primitive; the scope still applies. */
    stores: async (c) => ok(c, await service.listByKind(c.get("projectScope"), "storage")),
    testDraft: async (c) =>
      ok(c, await service.testDraft(param(c, "slug"), await parseBody(c, adapterDraftSchema))),
    create: async (c) => {
      const draft = await parseBody(c, adapterDraftSchema);
      return ok(c, await service.create(currentActor(c), param(c, "slug"), draft, meta(c)), 201);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    update: async (c) => {
      const patch = toPatch(await parseBody(c, adapterPatchSchema));
      return ok(
        c,
        await service.update(currentActor(c), param(c, "slug"), param(c, "id"), patch, meta(c))
      );
    },
    setMode: async (c) => {
      const input = await parseBody(c, setModeSchema);
      return ok(
        c,
        await service.setMode(
          currentActor(c),
          param(c, "slug"),
          param(c, "id"),
          input.mode,
          meta(c)
        )
      );
    },
    retest: async (c) =>
      ok(c, await service.retest(currentActor(c), param(c, "slug"), param(c, "id"), meta(c))),
    deletionPlan: async (c) => ok(c, await service.deletionPlan(param(c, "slug"), param(c, "id"))),
    remove: async (c) => {
      const input = await parseBody(c, adapterDeletionSchema);
      const job = await service.remove(
        currentActor(c),
        param(c, "slug"),
        param(c, "id"),
        input.plan_id,
        input.action,
        meta(c)
      );
      return respondWithJob(c, job, jobs, apiPrefix);
    },
  };
}
