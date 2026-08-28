import * as v from "valibot";
import type { Job } from "@testate/shared";
import { jobSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const jobsModel = {
  list: (): Promise<Job[]> => apiClient.get("/jobs", { schema: v.array(jobSchema) }),
  cancel: (id: string): Promise<Job> =>
    apiClient.post(`/jobs/${encodeURIComponent(id)}/cancel`, { schema: jobSchema }),
};
