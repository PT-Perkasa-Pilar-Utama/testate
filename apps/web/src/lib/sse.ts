import * as v from "valibot";
import { onCleanup } from "solid-js";
import { TERMINAL_JOB_STATUSES, jobSchema, jsonObjectSchema } from "@testate/shared";
import type { Job, JsonObject } from "@testate/shared";

const API = `${(import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "")}/api/v1`;

export type JobEvent =
  | { kind: "progress"; progress: JsonObject }
  | { kind: "status"; job: Job }
  | { kind: "heartbeat" };

const progressSchema = jsonObjectSchema;

/** Opens the job event stream; returns the cleanup that closes it. */
export function subscribeJob(jobId: string, onEvent: (event: JobEvent) => void): () => void {
  const source = new EventSource(`${API}/jobs/${jobId}/events`);
  source.addEventListener("progress", (message) => {
    const parsed = v.safeParse(progressSchema, JSON.parse(message.data));
    if (parsed.success) onEvent({ kind: "progress", progress: parsed.output });
  });
  source.addEventListener("status", (message) => {
    const parsed = v.safeParse(jobSchema, JSON.parse(message.data));
    if (parsed.success) onEvent({ kind: "status", job: parsed.output });
  });
  source.addEventListener("heartbeat", () => onEvent({ kind: "heartbeat" }));
  return () => source.close();
}

export type JobFollower = {
  /** Runs `onDone` with the terminal job: at once if it already ended, else when its stream says so. */
  follow(job: Job, onDone: (job: Job) => void): void;
  /**
   * The same, awaited. It settles when the job ends and also when the screen goes, which is the
   * difference that matters: a caller that awaits this and shows a spinner meanwhile would
   * otherwise wait for ever on a stream that never reaches a terminal event.
   */
  settle(job: Job): Promise<void>;
};

/**
 * Follows jobs for as long as the screen that asked is on screen.
 *
 * `EventSource` closes itself only when the job it watches ends. Nothing else does: a snapshot
 * started on one screen and then navigated away from left its stream open, and an `EventSource`
 * that errors reconnects on its own, so a torn-down screen went on holding a connection and
 * writing into signals whose owner was disposed.
 *
 * **Call this during setup**, in a presenter's own body, never inside an effect or after an
 * `await`. It registers an `onCleanup` with whatever owner is current at that moment, and a Solid
 * 2 effect body runs with no owner at all: an `onCleanup` there is never run and warns
 * `NO_OWNER_CLEANUP` while it does nothing.
 */
export function createJobFollower(): JobFollower {
  const open = new Set<() => void>();
  const waiting = new Set<() => void>();
  onCleanup(() => {
    for (const close of open) close();
    open.clear();
    for (const settle of waiting) settle();
    waiting.clear();
  });
  const follow = (job: Job, onDone: (job: Job) => void): void => {
    if (TERMINAL_JOB_STATUSES.includes(job.status)) {
      onDone(job);
      return;
    }
    let close = (): void => undefined;
    const stop = (): void => {
      open.delete(stop);
      close();
    };
    close = subscribeJob(job.id, (event) => {
      if (event.kind !== "status" || !TERMINAL_JOB_STATUSES.includes(event.job.status)) return;
      stop();
      onDone(event.job);
    });
    open.add(stop);
  };
  return {
    follow,
    settle: (job) =>
      new Promise<void>((resolve) => {
        const done = (): void => {
          waiting.delete(done);
          resolve();
        };
        waiting.add(done);
        follow(job, done);
      }),
  };
}
