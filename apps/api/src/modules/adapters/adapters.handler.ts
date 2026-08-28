import {
  adapterDeletionSchema,
  adapterDraftSchema,
  adapterPatchSchema,
  setModeSchema,
} from "@testate/shared";

import { currentActor } from "../../lib/http/auth.ts";
import { accepted, ok, okPage, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { AdaptersService } from "./adapters.service.ts";

export type AdaptersHandlers = {
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

export function createAdaptersHandlers(
  service: AdaptersService,
  apiPrefix: string
): AdaptersHandlers {
  return {
    list: async (c) => okPage(c, await service.list(param(c, "slug")), null, 50),
    testDraft: async (c) => ok(c, await service.testDraft(await parseBody(c, adapterDraftSchema))),
    create: async (c) => {
      const draft = await parseBody(c, adapterDraftSchema);
      return ok(c, await service.create(param(c, "slug"), draft), 201);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    update: async (c) => {
      await parseBody(c, adapterPatchSchema);
      return ok(c, await service.update(param(c, "slug"), param(c, "id")));
    },
    setMode: async (c) => {
      const input = await parseBody(c, setModeSchema);
      const actor = currentActor(c);
      return ok(c, await service.setMode(param(c, "slug"), param(c, "id"), input.mode, actor.role));
    },
    retest: async (c) => ok(c, await service.retest(param(c, "slug"), param(c, "id"))),
    deletionPlan: async (c) => ok(c, await service.deletionPlan(param(c, "slug"), param(c, "id"))),
    remove: async (c) => {
      const input = await parseBody(c, adapterDeletionSchema);
      const job = await service.remove(param(c, "slug"), param(c, "id"), input.plan_id);
      return accepted(c, job, apiPrefix);
    },
  };
}
