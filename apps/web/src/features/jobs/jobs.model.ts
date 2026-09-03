import type { Job } from "@testate/shared";
import { TERMINAL_JOB_STATUSES, jobSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Query } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import { tableQuery } from "@/lib/table.ts";
import type { TableParams } from "@/lib/table.ts";
import type { JobFilters, JobSort } from "./jobs.presenter.ts";

/** What `/jobs` takes: everything `tableQuery` builds, plus kind and status. */
export function jobsQuery(
  params: TableParams<JobSort>,
  cursor: string | undefined,
  filters: JobFilters
): Query {
  return {
    ...tableQuery(params, cursor),
    kind: filters.kind === "" ? undefined : filters.kind,
    status: filters.status === "" ? undefined : filters.status,
  };
}

export const jobsModel = {
  /** The list used to arrive through `get`, which reads `data` and throws the cursor away: every
   *  screen showed the first 50 jobs and nothing said so. */
  page: (
    cursor: string | undefined,
    params: TableParams<JobSort>,
    filters: JobFilters
  ): Promise<Page<Job>> => apiClient.page("/jobs", jobSchema, jobsQuery(params, cursor, filters)),
  cancel: (id: string): Promise<Job> =>
    apiClient.post(`/jobs/${encodeURIComponent(id)}/cancel`, { schema: jobSchema }),
  /**
   * The job once it ends, through the endpoint's own long poll rather than a screen's event
   * stream: a wait that must outlive the screen that started it (a comparison whose answer is a
   * toast) cannot ride on a stream that closes with the screen.
   */
  settled: async (id: string): Promise<Job> => {
    for (let round = 0; round < 40; round += 1) {
      const job = await apiClient.get(`/jobs/${encodeURIComponent(id)}`, {
        schema: jobSchema,
        query: { wait: "30" },
      });
      if (TERMINAL_JOB_STATUSES.includes(job.status)) return job;
    }
    throw new Error("The job is still running.");
  },
};
