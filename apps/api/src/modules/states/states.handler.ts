import {
  createStateSchema,
  importArchiveSchema,
  stateKindSchema,
  updateStateSchema,
} from "@testate/shared";
import * as v from "valibot";
import { nextCursor } from "../../lib/db/keyset.ts";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import {
  accepted,
  ok,
  okPage,
  param,
  parseBody,
  parseQuery,
  waitForJob,
  waitSeconds,
} from "../../lib/http/index.ts";
import type { Handler, JobWaiter } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { StatesFilter } from "./states.repository.ts";
import type { StatesService } from "./states.service.ts";

export type StatesHandlers = {
  list: Handler;
  tree: Handler;
  create: Handler;
  get: Handler;
  update: Handler;
  remove: Handler;
  archive: Handler;
  archiveManifest: Handler;
  importArchive: Handler;
};

const flag = v.array(v.picklist(["true", "false"]));
const listQuerySchema = v.object({
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  sort: v.optional(v.array(v.picklist(["created_at", "name", "size_bytes"]))),
  order: v.optional(v.array(v.picklist(["asc", "desc"]))),
  kind: v.optional(v.array(stateKindSchema)),
  tag: v.optional(v.array(v.string())),
  name: v.optional(v.array(v.string())),
  include_stash: v.optional(flag),
  cursor: v.optional(v.array(v.string())),
  protected: v.optional(flag),
  created_from: v.optional(v.array(v.string())),
  created_to: v.optional(v.array(v.string())),
});

/** Every string filter, folded through one loop: a branch per field is what tipped this over 10. */
const TEXT_KEYS = ["cursor", "tag", "name", "created_from", "created_to"] as const;

function toFilter(parsed: v.InferOutput<typeof listQuerySchema>): StatesFilter {
  const filter: StatesFilter = {
    limit: firstQuery(parsed.limit) ?? 50,
    sort: firstQuery(parsed.sort) ?? "created_at",
    order: firstQuery(parsed.order) ?? "desc",
    includeStash: firstQuery(parsed.include_stash) === "true",
  };
  for (const key of TEXT_KEYS) {
    const value = firstQuery(parsed[key]);
    if (value !== undefined) filter[key] = value;
  }
  const kind = firstQuery(parsed.kind);
  if (kind !== undefined) filter.kind = kind;
  const isProtected = firstQuery(parsed.protected);
  if (isProtected !== undefined) filter.protected = isProtected === "true";
  return filter;
}

export function createStatesHandlers(
  service: StatesService,
  apiPrefix: string,
  trustProxy: boolean,
  jobs: JobWaiter
): StatesHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    list: async (c) => {
      const filter = toFilter(parseQuery(c, listQuerySchema));
      const rows = await service.list(param(c, "slug"), filter);
      const next = nextCursor(rows, filter.limit, filter, (row) => [row[filter.sort], row.id]);
      return okPage(c, rows, next, filter.limit);
    },
    tree: async (c) => {
      const filter = toFilter(parseQuery(c, listQuerySchema));
      return ok(c, await service.tree(param(c, "slug"), filter.includeStash));
    },
    create: async (c) => {
      const input = await parseBody(c, createStateSchema);
      const { state, job } = await service.snapshot(
        currentActor(c),
        param(c, "slug"),
        input,
        meta(c)
      );
      c.header("Location", `${apiPrefix}/jobs/${job.id}`);
      const seconds = waitSeconds(c);
      if (seconds === undefined) return ok(c, { state, job }, 202);
      const done = await waitForJob(jobs, c.get("projectScope"), job.id, seconds);
      const detail = await service.get(param(c, "slug"), state.id);
      return ok(c, { state: detail, job: done.job }, done.status);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    update: async (c) => {
      const patch = await parseBody(c, updateStateSchema);
      return ok(
        c,
        await service.update(currentActor(c), param(c, "slug"), param(c, "id"), patch, meta(c))
      );
    },
    remove: async (c) =>
      accepted(
        c,
        await service.remove(currentActor(c), param(c, "slug"), param(c, "id"), meta(c)),
        apiPrefix
      ),
    archive: async (c) => {
      const { state, body } = await service.archive(param(c, "slug"), param(c, "id"));
      c.header("Content-Type", "application/x-tar");
      c.header(
        "Content-Disposition",
        `attachment; filename="testate-state-${param(c, "slug")}-${state.name}.tar"`
      );
      return c.body(body, 200);
    },
    archiveManifest: async (c) =>
      ok(c, await service.archiveManifest(param(c, "slug"), param(c, "upload_id"))),
    importArchive: async (c) => {
      const input = await parseBody(c, importArchiveSchema);
      const job = await service.importArchive(currentActor(c), param(c, "slug"), input, meta(c));
      const seconds = waitSeconds(c);
      c.header("Location", `${apiPrefix}/jobs/${job.id}`);
      if (seconds === undefined) return ok(c, job, 202);
      const done = await waitForJob(jobs, c.get("projectScope"), job.id, seconds);
      return ok(c, done.job, done.status);
    },
  };
}
