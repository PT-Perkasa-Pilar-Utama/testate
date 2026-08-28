import { createHookSchema, reorderHooksSchema, updateHookSchema } from "@testate/shared";
import * as v from "valibot";

import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { HooksService } from "./hooks.service.ts";

export type HooksHandlers = {
  list: Handler;
  create: Handler;
  update: Handler;
  remove: Handler;
  reorder: Handler;
};

const listQuery = v.object({ trigger: v.optional(v.array(v.string())) });

export function createHooksHandlers(service: HooksService): HooksHandlers {
  return {
    list: async (c) => {
      const query = parseQuery(c, listQuery);
      return okPage(c, await service.list(param(c, "slug"), query.trigger?.[0]), null, 50);
    },
    create: async (c) => {
      const body = await parseBody(c, createHookSchema);
      return ok(c, await service.create(param(c, "slug"), body.trigger, body.rest_request_id), 201);
    },
    update: async (c) => {
      await parseBody(c, updateHookSchema);
      return ok(c, await service.update(param(c, "slug"), param(c, "id")));
    },
    remove: async (c) => {
      await service.remove(param(c, "slug"), param(c, "id"));
      return c.body(null, 204);
    },
    reorder: async (c) => {
      const body = await parseBody(c, reorderHooksSchema);
      return ok(c, await service.reorder(param(c, "slug"), body.trigger, body.hook_ids));
    },
  };
}
