import {
  TERMINAL_JOB_STATUSES,
  stateRefBodySchema,
  terminateBlockersSchema,
} from "@testate/shared";
import * as v from "valibot";
import { nextCursor } from "../../lib/db/keyset.ts";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { CheckoutsFilter } from "./checkouts.repository.ts";
import type { CheckoutWithJob, CheckoutsService } from "./checkouts.service.ts";

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

const listQuery = v.object({
  cursor: v.optional(v.array(v.string())),
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  status: v.optional(
    v.array(v.picklist(["running", "succeeded", "partial", "failed", "cancelled", "interrupted"]))
  ),
  state_id: v.optional(v.array(v.string())),
  purpose: v.optional(v.array(v.picklist(["checkout", "return_to_init"]))),
});
const waitQuery = v.object({
  wait: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(300)))
  ),
});

function toFilter(parsed: v.InferOutput<typeof listQuery>): CheckoutsFilter {
  const filter: CheckoutsFilter = { limit: firstQuery(parsed.limit) ?? 50 };
  const cursor = firstQuery(parsed.cursor);
  if (cursor !== undefined) filter.cursor = cursor;
  const status = firstQuery(parsed.status);
  if (status !== undefined) filter.status = status;
  const stateId = firstQuery(parsed.state_id);
  if (stateId !== undefined) filter.state_id = stateId;
  const purpose = firstQuery(parsed.purpose);
  if (purpose !== undefined) filter.purpose = purpose;
  return filter;
}

export function createCheckoutsHandlers(
  service: CheckoutsService,
  apiPrefix: string,
  trustProxy: boolean,
  jobs: Pick<JobsService, "wait">
): CheckoutsHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  /** `?wait=` long-polls the job; a terminal job answers `200` with the finished checkout (09 §9.2). */
  const respond = async (c: Parameters<Handler>[0], result: CheckoutWithJob): Promise<Response> => {
    const seconds = firstQuery(parseQuery(c, waitQuery).wait);
    c.header("Location", `${apiPrefix}/jobs/${result.job.id}`);
    if (seconds === undefined) return ok(c, result, 202);
    const job = await jobs.wait(c.get("projectScope"), result.job.id, seconds);
    const checkout = await service.get(param(c, "slug"), result.checkout.id);
    return ok(c, { checkout, job }, TERMINAL_JOB_STATUSES.includes(job.status) ? 200 : 202);
  };
  return {
    preflight: async (c) =>
      ok(c, await service.preflight(param(c, "slug"), await parseBody(c, stateRefBodySchema))),
    create: async (c) => {
      const input = await parseBody(c, stateRefBodySchema);
      return respond(c, await service.create(currentActor(c), param(c, "slug"), input, meta(c)));
    },
    list: async (c) => {
      const filter = toFilter(parseQuery(c, listQuery));
      const rows = await service.list(param(c, "slug"), filter);
      const next = nextCursor(rows, filter.limit, (row) => [row.created_at, row.id]);
      return okPage(c, rows, next, filter.limit);
    },
    get: async (c) => ok(c, await service.get(param(c, "slug"), param(c, "id"))),
    retry: async (c) =>
      respond(c, await service.retry(currentActor(c), param(c, "slug"), param(c, "id"), meta(c))),
    terminateBlockers: async (c) => {
      const input = await parseBody(c, terminateBlockersSchema);
      return ok(
        c,
        await service.terminateBlockers(
          currentActor(c),
          param(c, "slug"),
          param(c, "id"),
          input.adapter_id,
          input.session_ids,
          meta(c)
        )
      );
    },
    counters: async (c) => ok(c, await service.counters(param(c, "slug"), param(c, "id"))),
    repairCounters: async (c) =>
      ok(
        c,
        await service.repairCounters(currentActor(c), param(c, "slug"), param(c, "id"), meta(c))
      ),
  };
}
