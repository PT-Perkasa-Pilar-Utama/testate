import { createEffect, createSignal } from "solid-js";
import type { Job, JsonObject } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";
import * as v from "valibot";

import { attempt } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { subscribeJob } from "@/lib/sse.ts";
import { jobsModel } from "./jobs.model.ts";

export type JobsPresenter = Refreshable<Job[]> & {
  cancel: (id: string) => Promise<void>;
};

export type LiveJob = {
  progress: () => JsonObject | null;
  status: () => Job["status"];
};

const scalarSchema = v.union([v.string(), v.number(), v.boolean()]);

export function canCancel(job: Job): boolean {
  return !TERMINAL_JOB_STATUSES.includes(job.status) && !job.cancel_requested;
}

/** "restore · public.orders · 12/42" from a progress object; keys are engine-defined. */
export function describeProgress(progress: JsonObject | null): string {
  if (progress === null) return "";
  return Object.entries(progress)
    .flatMap(([key, value]) => {
      const scalar = v.safeParse(scalarSchema, value);
      return scalar.success ? [`${key} ${String(scalar.output)}`] : [];
    })
    .join(" · ");
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

/**
 * Follows one non-terminal job over SSE (14 §14.5). The stream closes itself after the terminal
 * status; `onDone` lets the list refresh. The effect's cleanup closes the source on unmount.
 */
export function createLiveJob(job: () => Job, onDone: () => void): LiveJob {
  const [progress, setProgress] = createSignal<JsonObject | null>(job().progress);
  const [status, setStatus] = createSignal<Job["status"]>(job().status);
  createEffect(
    () => (canCancel(job()) || job().status === "running" ? job().id : null),
    (id) => {
      if (id === null) return undefined;
      return subscribeJob(id, (event) => {
        if (event.kind === "progress") setProgress(event.progress);
        if (event.kind === "status") {
          setStatus(event.job.status);
          setProgress(event.job.progress);
          if (TERMINAL_JOB_STATUSES.includes(event.job.status)) onDone();
        }
      });
    }
  );
  return { progress, status };
}
