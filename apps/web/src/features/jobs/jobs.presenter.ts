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

/**
 * Split from `canCancel` so a row can key the check off the live SSE status instead of the row's
 * initial prop: the point of a live list is that Cancel disappears the moment the stream says
 * terminal, not when the next list refresh happens to land.
 */
export function cancelable(status: Job["status"], cancelRequested: boolean): boolean {
  return !TERMINAL_JOB_STATUSES.includes(status) && !cancelRequested;
}

export function canCancel(job: Job): boolean {
  return cancelable(job.status, job.cancel_requested);
}

/** What a person calls each job kind; `job.kind` itself is the code's word for it. */
export const JOB_KIND_LABEL = {
  snapshot: "Snapshot",
  checkout: "Checkout",
  import: "Import",
  diff: "Comparison",
  state_delete: "Delete state",
  adapter_delete: "Delete adapter",
  project_delete: "Delete project",
  archive_import: "Import archive",
  storage_migration: "Storage migration",
  backup: "Backup",
} as const;

/** The keys the jobs push; anything else on the object is for the log, not for a person. */
const progressSchema = v.object({
  phase: v.optional(v.string()),
  trigger: v.optional(v.string()),
  table: v.optional(v.string()),
  tables_done: v.optional(v.number()),
  tables_total: v.optional(v.number()),
  rows: v.optional(v.number()),
  done: v.optional(v.number()),
  total: v.optional(v.number()),
});

type Progress = v.InferOutput<typeof progressSchema>;

function phraseOf(progress: Progress): string {
  const phase = progress.phase ?? "";
  if (phase === "snapshot") return "Snapshotting";
  if (phase === "restore") return "Restoring";
  if (phase === "stash") return "Stashing the live data";
  if (phase === "merge") return "Comparing";
  if (phase === "write") return "Writing rows";
  return phase === "" ? "Working" : phase;
}

function countOf(progress: Progress): string {
  const tables = progress.tables_done;
  if (tables !== undefined) {
    const total = progress.tables_total;
    return total === undefined ? `${tables} tables` : `${tables} of ${total} tables`;
  }
  const rows = progress.rows;
  if (rows !== undefined) {
    const total = progress.total;
    return total === undefined ? `${rows} rows` : `${rows} of ${total} rows`;
  }
  const done = progress.done;
  if (done === undefined) return "";
  const total = progress.total;
  return total === undefined ? `${done} done` : `${done} of ${total} adapters`;
}

function parseProgress(progress: JsonObject | null): Progress | null {
  if (progress === null) return null;
  const parsed = v.safeParse(progressSchema, progress);
  return parsed.success ? parsed.output : null;
}

/**
 * A sentence, not the record. It used to print every key, including the adapter's UUID, which
 * told the reader nothing and pushed the row onto two lines.
 */
export function describeProgress(progress: JsonObject | null): string {
  const parsed = parseProgress(progress);
  if (parsed === null) return "";
  const parts = [phraseOf(parsed), parsed.table ?? ""].filter((part) => part !== "");
  const count = countOf(parsed);
  return count === "" ? parts.join(" ") : `${parts.join(" ")}, ${count}`;
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined || denominator === 0) return null;
  return numerator / denominator;
}

/** The same counters `countOf` reads, as a 0-1 fraction for a meter; null when nothing counts. */
export function progressFraction(progress: JsonObject | null): number | null {
  const parsed = parseProgress(progress);
  if (parsed === null) return null;
  return (
    ratio(parsed.tables_done, parsed.tables_total) ??
    ratio(parsed.rows, parsed.total) ??
    ratio(parsed.done, parsed.total)
  );
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
