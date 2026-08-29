import {
  createHookSchema,
  hookTriggerSchema,
  reorderHooksSchema,
  updateHookSchema,
} from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { HookPatch } from "./hooks.repository.ts";
import type { HooksService } from "./hooks.service.ts";

export type HooksHandlers = {
  list: Handler;
  create: Handler;
  update: Handler;
  remove: Handler;
  reorder: Handler;
};

const listQuery = v.object({ trigger: v.optional(v.array(hookTriggerSchema)) });

function toPatch(body: v.InferOutput<typeof updateHookSchema>): HookPatch {
  const patch: HookPatch = {};
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.fail_policy !== undefined) patch.fail_policy = body.fail_policy;
  if (body.rest_request_id !== undefined) patch.rest_request_id = body.rest_request_id;
  return patch;
}

export function createHooksHandlers(service: HooksService, trustProxy: boolean): HooksHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    list: async (c) => {
      const trigger = firstQuery(parseQuery(c, listQuery).trigger);
      return okPage(c, await service.list(param(c, "slug"), trigger), null, 50);
    },
    create: async (c) => {
      const body = await parseBody(c, createHookSchema);
      return ok(c, await service.create(currentActor(c), param(c, "slug"), body, meta(c)), 201);
    },
    update: async (c) => {
      const body = await parseBody(c, updateHookSchema);
      return ok(
        c,
        await service.update(
          currentActor(c),
          param(c, "slug"),
          param(c, "id"),
          toPatch(body),
          meta(c)
        )
      );
    },
    remove: async (c) => {
      await service.remove(currentActor(c), param(c, "slug"), param(c, "id"), meta(c));
      return c.body(null, 204);
    },
    reorder: async (c) => {
      const body = await parseBody(c, reorderHooksSchema);
      return ok(c, await service.reorder(param(c, "slug"), body.trigger, body.hook_ids));
    },
  };
}
