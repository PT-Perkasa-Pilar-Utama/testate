import { createStateSchema, importArchiveSchema, updateStateSchema } from "@testate/shared";
import * as v from "valibot";

import { accepted, ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
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

const listQuerySchema = v.object({
  include_stash: v.optional(v.array(v.picklist(["true", "false"]))),
});

function includeStash(c: Parameters<Handler>[0]): boolean {
  const query = parseQuery(c, listQuerySchema);
  return query.include_stash?.[0] === "true";
}

export function createStatesHandlers(service: StatesService, apiPrefix: string): StatesHandlers {
  return {
    list: async (c) => okPage(c, await service.list(param(c, "slug"), includeStash(c)), null, 50),
    tree: async (c) => ok(c, await service.tree(param(c, "slug"), includeStash(c))),
    create: async (c) => {
      const input = await parseBody(c, createStateSchema);
      const { state, job } = await service.snapshot(param(c, "slug"), input);
      c.header("Location", `${apiPrefix}/jobs/${job.id}`);
      return ok(c, { state, job }, 202);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    update: async (c) => {
      const patch = await parseBody(c, updateStateSchema);
      return ok(c, await service.update(param(c, "slug"), param(c, "id"), patch));
    },
    remove: async (c) =>
      accepted(c, await service.remove(param(c, "slug"), param(c, "id")), apiPrefix),
    archive: async (c) => {
      const state = await service.get(param(c, "slug"), param(c, "id"));
      c.header("Content-Type", "application/x-tar");
      c.header(
        "Content-Disposition",
        `attachment; filename="testate-state-${param(c, "slug")}-${state.name}.tar"`
      );
      return c.body("", 200);
    },
    archiveManifest: async (c) => ok(c, await service.archiveManifest(param(c, "upload_id"))),
    importArchive: async (c) => {
      const input = await parseBody(c, importArchiveSchema);
      return accepted(c, await service.importArchive(param(c, "slug"), input.name), apiPrefix);
    },
  };
}
