import type { Job } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { attempt } from "@/components/toast.tsx";
import { jobsModel } from "./jobs.model.ts";

export type JobsPresenter = Refreshable<Job[]> & {
  cancel: (id: string) => Promise<void>;
};

export function canCancel(job: Job): boolean {
  return !TERMINAL_JOB_STATUSES.includes(job.status) && !job.cancel_requested;
}

export function createJobsPresenter(): JobsPresenter {
  const jobs = createRefreshable(() => jobsModel.list());
  return {
    ...jobs,
    cancel: (id) =>
      attempt(async () => {
        await jobsModel.cancel(id);
        jobs.refresh();
      }),
  };
}
