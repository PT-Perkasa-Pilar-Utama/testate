import { stateRefBodySchema, terminateBlockersSchema } from "@testate/shared";

import { ok, okPage, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { CheckoutsService } from "./checkouts.service.ts";

export type CheckoutsHandlers = {
  preflight: Handler;
  create: Handler;
  list: Handler;
  get: Handler;
  retry: Handler;
  terminateBlockers: Handler;
  counters: Handler;
  repairCounters: Handler;
};

export function createCheckoutsHandlers(
  service: CheckoutsService,
  apiPrefix: string
): CheckoutsHandlers {
  return {
    preflight: async (c) =>
      ok(c, await service.preflight(param(c, "slug"), await parseBody(c, stateRefBodySchema))),
    create: async (c) => {
      const result = await service.create(param(c, "slug"), await parseBody(c, stateRefBodySchema));
      c.header("Location", `${apiPrefix}/jobs/${result.job.id}`);
      return ok(c, result, 202);
    },
    list: async (c) => okPage(c, await service.list(param(c, "slug")), null, 50),
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    retry: async (c) => {
      const result = await service.retry(param(c, "slug"), param(c, "id"));
      c.header("Location", `${apiPrefix}/jobs/${result.job.id}`);
      return ok(c, result, 202);
    },
    terminateBlockers: async (c) => {
      const input = await parseBody(c, terminateBlockersSchema);
      return ok(
        c,
        await service.terminateBlockers(param(c, "slug"), param(c, "id"), input.session_ids)
      );
    },
    counters: async (c) => ok(c, await service.counters(param(c, "slug"), param(c, "id"))),
    repairCounters: async (c) =>
      ok(c, await service.repairCounters(param(c, "slug"), param(c, "id"))),
  };
}
