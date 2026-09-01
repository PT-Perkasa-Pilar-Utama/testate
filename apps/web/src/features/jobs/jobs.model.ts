import type { Job } from "@testate/shared";
import { jobSchema } from "@testate/shared";

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
};
