import { streamSSE } from "hono/streaming";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";
import * as v from "valibot";

import { currentActor } from "../../lib/http/auth.ts";
import { ok, okPage, param, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { JobsService } from "./jobs.service.ts";

export type JobsHandlers = {
  list: Handler;
  get: Handler;
  cancel: Handler;
  events: Handler;
};

const waitQuery = v.object({ wait: v.optional(v.array(v.string())) });

export function createJobsHandlers(service: JobsService): JobsHandlers {
  return {
    list: async (c) => okPage(c, await service.list(currentActor(c)), null, 50),
    get: async (c) => {
      const query = parseQuery(c, waitQuery);
      const seconds = Number(query.wait?.[0] ?? "0");
      const job =
        seconds > 0
          ? await service.wait(param(c, "id"), seconds)
          : await service.get(param(c, "id"));
      return ok(c, job, TERMINAL_JOB_STATUSES.includes(job.status) ? 200 : 202);
    },
    cancel: async (c) => ok(c, await service.cancel(currentActor(c), param(c, "id")), 202),
    events: async (c) => {
      const job = await service.get(param(c, "id"));
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "status", id: "1", data: JSON.stringify(job) });
      });
    },
  };
}
