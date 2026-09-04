import { TERMINAL_JOB_STATUSES } from "@testate/shared";
import type { Job } from "@testate/shared";
import type { Context } from "hono";
import * as v from "valibot";

import { validationError } from "./errors.ts";

/** `?wait=` seconds, 1-300, honoured by every job-creating POST (docs/api-specs/01-conventions.md). */
export const waitQuerySchema = v.object({
  wait: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(300)))
  ),
});

/** The `wait` query parameter, parsed and capped; undefined when the caller did not ask to wait. */
export function waitSeconds(c: Context): number | undefined {
  const result = v.safeParse(waitQuerySchema, c.req.queries());
  if (!result.success) throw validationError(result.issues, "query");
  return result.output.wait?.[0];
}

/** The slice of `JobsService` a `?wait=` handler needs; avoids a `lib/http` -> `modules` import. */
export type JobWaiter = {
  wait(scope: string[] | null, id: string, seconds: number): Promise<Job>;
};

/** Long-polls a job to termination or `seconds` out, whichever comes first (09 §9.2). */
export async function waitForJob(
  jobs: JobWaiter,
  scope: string[] | null,
  jobId: string,
  seconds: number
): Promise<{ job: Job; status: 200 | 202 }> {
  const job = await jobs.wait(scope, jobId, seconds);
  return { job, status: TERMINAL_JOB_STATUSES.includes(job.status) ? 200 : 202 };
}
