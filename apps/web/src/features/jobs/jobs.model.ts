import type { Job } from "@testate/shared";
import { jobSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import { tableQuery } from "@/lib/table.ts";
import type { TableParams } from "@/lib/table.ts";
import type { JobSort } from "./jobs.presenter.ts";

export const jobsModel = {
  /** The list used to arrive through `get`, which reads `data` and throws the cursor away: every
   *  screen showed the first 50 jobs and nothing said so. */
  page: (cursor: string | undefined, params: TableParams<JobSort>): Promise<Page<Job>> =>
    apiClient.page("/jobs", jobSchema, tableQuery(params, cursor)),
  cancel: (id: string): Promise<Job> =>
    apiClient.post(`/jobs/${encodeURIComponent(id)}/cancel`, { schema: jobSchema }),
};
