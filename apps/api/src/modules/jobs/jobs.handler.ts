import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { TERMINAL_JOB_STATUSES, jobKindSchema, jobStatusSchema } from "@testate/shared";
import type { Job } from "@testate/shared";
import * as v from "valibot";

import { currentActor } from "../../lib/http/auth.ts";
import { accepted, ok, okPage, param, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { JobsFilter, JobsService } from "./jobs.service.ts";

export type JobsHandlers = {
  list: Handler;
  get: Handler;
  cancel: Handler;
  events: Handler;
};

const waitQuery = v.object({
  wait: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(300)))
  ),
});

const listQuery = v.object({
  cursor: v.optional(v.array(v.string())),
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  sort: v.optional(v.array(v.picklist(["created_at", "kind", "status"]))),
  order: v.optional(v.array(v.picklist(["asc", "desc"]))),
  q: v.optional(v.array(v.string())),
  project_id: v.optional(v.array(v.string())),
  adapter_id: v.optional(v.array(v.string())),
  kind: v.optional(v.array(jobKindSchema)),
  status: v.optional(v.array(jobStatusSchema)),
  created_from: v.optional(v.array(v.string())),
  created_to: v.optional(v.array(v.string())),
});

/** Every string filter, folded through one loop: a branch per field is what tipped this over 10. */
const TEXT_KEYS = [
  "q",
  "cursor",
  "project_id",
  "adapter_id",
  "created_from",
  "created_to",
] as const;

function toFilter(parsed: v.InferOutput<typeof listQuery>): JobsFilter {
  const filter: JobsFilter = {
    limit: firstQuery(parsed.limit) ?? 50,
    sort: firstQuery(parsed.sort) ?? "created_at",
    order: firstQuery(parsed.order) ?? "desc",
  };
  for (const key of TEXT_KEYS) {
    const value = firstQuery(parsed[key]);
    if (value !== undefined) filter[key] = value;
  }
  const kind = firstQuery(parsed.kind);
  if (kind !== undefined) filter.kind = kind;
  const status = firstQuery(parsed.status);
  if (status !== undefined) filter.status = status;
  return filter;
}

/** `?wait=` on a job-creating POST or a job GET: 200 when terminal, 202 while it runs (16 §16.1). */
export async function respondWithJob(
  c: Context,
  job: Job,
  jobs: JobsService,
  apiPrefix: string
): Promise<Response> {
  const seconds = firstQuery(parseQuery(c, waitQuery).wait);
  const settled =
    seconds === undefined ? job : await jobs.wait(c.get("projectScope"), job.id, seconds);
  if (TERMINAL_JOB_STATUSES.includes(settled.status)) return ok(c, settled, 200);
  return accepted(c, settled, apiPrefix);
}

export function createJobsHandlers(service: JobsService): JobsHandlers {
  return {
    list: async (c) => {
      const filter = toFilter(parseQuery(c, listQuery));
      const page = await service.list(currentActor(c), c.get("projectScope"), filter);
      const total = await service.total(currentActor(c), c.get("projectScope"), filter);
      return okPage(c, page.rows, page.nextCursor, filter.limit, total);
    },
    get: async (c) => {
      const scope = c.get("projectScope");
      const seconds = firstQuery(parseQuery(c, waitQuery).wait);
      const id = param(c, "id");
      const job =
        seconds === undefined
          ? await service.get(scope, id)
          : await service.wait(scope, id, seconds);
      return ok(c, job, TERMINAL_JOB_STATUSES.includes(job.status) ? 200 : 202);
    },
    cancel: async (c) =>
      ok(c, await service.cancel(currentActor(c), c.get("projectScope"), param(c, "id")), 202),
    events: async (c) => {
      const scope = c.get("projectScope");
      const id = param(c, "id");
      await service.get(scope, id);
      const lastId = c.req.header("last-event-id");
      const afterSeq = lastId === undefined ? null : Number(lastId);
      return streamSSE(c, async (stream) => {
        const controller = new AbortController();
        stream.onAbort(() => controller.abort());
        for await (const item of service.events(
          scope,
          id,
          Number.isInteger(afterSeq) ? afterSeq : null,
          controller.signal
        )) {
          if (item.event === "heartbeat") {
            await stream.writeSSE({ event: "heartbeat", data: "" });
            continue;
          }
          await stream.writeSSE({
            event: item.event,
            id: String(item.seq),
            data: JSON.stringify(item.data),
          });
        }
      });
    },
  };
}
