import type { Job, JsonObject } from "@testate/shared";

/** One SSE frame: `progress` carries the progress object, `status` the whole job (14 §14.5). */
export type JobEvent =
  | { seq: number; event: "progress"; data: JsonObject }
  | { seq: number; event: "status"; data: Job };

export type JobListener = (event: JobEvent) => void;

export type JobEventHub = {
  publishProgress(jobId: string, progress: JsonObject): void;
  publishStatus(job: Job): void;
  subscribe(jobId: string, listener: JobListener): () => void;
  /** The latest status frame, for `Last-Event-ID` replays. */
  lastStatus(jobId: string): JobEvent | null;
  forget(jobId: string): void;
};

/** In-process fan-out from the dispatcher to SSE streams and waiters; one process, so no bus. */
export function createJobEventHub(): JobEventHub {
  const listeners = new Map<string, Set<JobListener>>();
  const sequences = new Map<string, number>();
  const statuses = new Map<string, JobEvent>();
  const next = (jobId: string): number => {
    const seq = (sequences.get(jobId) ?? 0) + 1;
    sequences.set(jobId, seq);
    return seq;
  };
  const emit = (jobId: string, event: JobEvent): void => {
    for (const listener of listeners.get(jobId) ?? []) listener(event);
  };
  return {
    publishProgress(jobId, progress) {
      emit(jobId, { seq: next(jobId), event: "progress", data: progress });
    },
    publishStatus(job) {
      const event: JobEvent = { seq: next(job.id), event: "status", data: job };
      statuses.set(job.id, event);
      emit(job.id, event);
    },
    subscribe(jobId, listener) {
      const set = listeners.get(jobId) ?? new Set<JobListener>();
      set.add(listener);
      listeners.set(jobId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(jobId);
      };
    },
    lastStatus: (jobId) => statuses.get(jobId) ?? null,
    forget(jobId) {
      listeners.delete(jobId);
      sequences.delete(jobId);
      statuses.delete(jobId);
    },
  };
}
