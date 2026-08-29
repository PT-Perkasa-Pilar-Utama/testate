import type { Job, JobKind, JobStatus, JsonObject } from "@testate/shared";

import { AppError } from "../../lib/http/index.ts";
import type { WideEvent } from "../../lib/logger/index.ts";
import type { JobEventHub } from "./jobs.events.ts";
import type { JobError, JobRecord, JobsRepository } from "./jobs.repository.ts";
import { toJob } from "./jobs.repository.ts";

export type JobRunnerContext = {
  job: JobRecord;
  event: WideEvent;
  signal: AbortSignal;
  /** Batched: at most one write every 250 ms per job (16 §16.1). */
  progress: (progress: JsonObject) => void;
};

export type JobOutcome = { status: "succeeded" | "partial"; result: JsonObject };

export type JobRunner = (ctx: JobRunnerContext) => Promise<JobOutcome>;

export type Heartbeat = {
  alive: boolean;
  running: number;
  queued: number;
  lastTickAt: string | null;
};

export type Dispatcher = {
  registerKind(kind: JobKind, runner: JobRunner): void;
  start(): void;
  /** Runs a tick now (after enqueue) instead of waiting for the timer. */
  poke(): void;
  abort(jobId: string): boolean;
  /** Shutdown (22 §22.4): stop taking jobs, abort runners, wait up to `timeoutMs`; returns the survivors. */
  drain(timeoutMs: number): Promise<string[]>;
  heartbeat(): Heartbeat;
  runningIds(): string[];
};

export type DispatcherDeps = {
  repo: JobsRepository;
  hub: JobEventHub;
  events: { create(kind: "job"): WideEvent };
  cap: number;
  tickMs?: number;
  progressMs?: number;
  now: () => Date;
};

type Task = { job: JobRecord; controller: AbortController; done: Promise<void> };

function errorOf(cause: unknown): JobError {
  if (cause instanceof AppError) {
    return cause.details === undefined
      ? { code: cause.code, message: cause.message }
      : { code: cause.code, message: cause.message, details: cause.details };
  }
  return { code: "INTERNAL", message: cause instanceof Error ? cause.message : String(cause) };
}

/**
 * One loop, one process: every tick starts queued jobs whose adapters no running job claims, up to
 * the cap (16 §16.3). A rejection in one task never touches another.
 */
export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const runners = new Map<JobKind, JobRunner>();
  const tasks = new Map<string, Task>();
  const tickMs = deps.tickMs ?? 500;
  const progressMs = deps.progressMs ?? 250;
  let timer: ReturnType<typeof setInterval> | null = null;
  let paused = false;
  let lastTickAt: string | null = null;
  let ticking = false;
  const nowIso = (): string => deps.now().toISOString();

  const claimed = (): Set<string> => {
    const ids = new Set<string>();
    for (const task of tasks.values()) for (const id of task.job.adapter_ids) ids.add(id);
    return ids;
  };

  const publish = (job: JobRecord): void => {
    const fresh = deps.repo.byId(job.id);
    deps.hub.publishStatus(toJob(fresh ?? job));
  };

  const finish = (
    job: JobRecord,
    status: JobStatus,
    result: JsonObject | null,
    error: JobError | null,
    event: WideEvent,
    startedAt: number
  ): void => {
    deps.repo.finish(job.id, status, result, error, nowIso());
    event.add("op", {
      name: `job:${job.kind}`,
      job_id: job.id,
      status,
      project_id: job.project_id,
      adapter_ids: job.adapter_ids.join(","),
    });
    if (error !== null) event.add("error", { code: error.code, message: error.message });
    event.emit({ durationMs: Date.now() - startedAt });
    tasks.delete(job.id);
    publish(job);
  };

  const run = async (job: JobRecord, controller: AbortController): Promise<void> => {
    const startedAt = Date.now();
    const event = deps.events.create("job");
    const runner = runners.get(job.kind);
    if (runner === undefined) {
      finish(
        job,
        "failed",
        null,
        { code: "INTERNAL", message: `no runner for ${job.kind}` },
        event,
        startedAt
      );
      return;
    }
    let pending: JsonObject | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      flushTimer = null;
      if (pending === null) return;
      deps.repo.setProgress(job.id, pending);
      deps.hub.publishProgress(job.id, pending);
      pending = null;
    };
    const progress = (value: JsonObject): void => {
      pending = value;
      if (flushTimer === null) flushTimer = setTimeout(flush, progressMs);
    };
    try {
      const outcome = await runner({ job, event, signal: controller.signal, progress });
      flush();
      finish(
        job,
        controller.signal.aborted ? "cancelled" : outcome.status,
        outcome.result,
        null,
        event,
        startedAt
      );
    } catch (cause: unknown) {
      flush();
      const status: JobStatus = controller.signal.aborted ? "cancelled" : "failed";
      finish(job, status, null, errorOf(cause), event, startedAt);
    }
  };

  const tick = (): void => {
    if (paused || ticking) return;
    ticking = true;
    lastTickAt = nowIso();
    try {
      const taken = claimed();
      for (const job of deps.repo.queued()) {
        if (tasks.size >= deps.cap) break;
        if (job.adapter_ids.some((id) => taken.has(id))) continue;
        for (const id of job.adapter_ids) taken.add(id);
        deps.repo.markRunning(job.id, nowIso());
        const controller = new AbortController();
        const running = deps.repo.byId(job.id) ?? job;
        const task: Task = { job: running, controller, done: Promise.resolve() };
        tasks.set(job.id, task);
        publish(running);
        task.done = run(running, controller);
      }
    } finally {
      ticking = false;
    }
  };

  return {
    registerKind(kind, runner) {
      runners.set(kind, runner);
    },
    start() {
      if (timer !== null) return;
      paused = false;
      timer = setInterval(tick, tickMs);
      tick();
    },
    poke() {
      if (timer !== null) queueMicrotask(tick);
    },
    abort(jobId) {
      const task = tasks.get(jobId);
      if (task === undefined) return false;
      task.controller.abort();
      return true;
    },
    async drain(timeoutMs) {
      paused = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      for (const task of tasks.values()) task.controller.abort();
      const all = Promise.allSettled([...tasks.values()].map((task) => task.done));
      await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
      return [...tasks.keys()];
    },
    heartbeat: () => ({
      alive: timer !== null && !paused,
      running: tasks.size,
      queued: deps.repo.countQueued(),
      lastTickAt,
    }),
    runningIds: () => [...tasks.keys()],
  };
}

export type { Job };
