import type { Actor, Job } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import { conflict, forbidden, notFound } from "../../lib/http/index.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";

export type JobsService = {
  list(actor: Actor): Promise<Job[]>;
  get(id: string): Promise<Job>;
  wait(id: string, seconds: number): Promise<Job>;
  cancel(actor: Actor, id: string): Promise<Job>;
  heartbeat(): { alive: boolean; running: number; queued: number; lastTickAt: string | null };
};

/** SCAFFOLD: one finished job and one queued job. The jobs card wires the dispatcher (spec 16). */
export function createJobsService(): JobsService {
  const queued: Job = {
    ...PROJECT_JOB_MOCK,
    id: "01991f00-0000-7000-8000-000000000041",
    kind: "snapshot",
    status: "queued",
    queue_position: 1,
    started_at: null,
    finished_at: null,
    result: null,
    progress: null,
  };
  const jobs = new Map<string, Job>([
    [PROJECT_JOB_MOCK.id, PROJECT_JOB_MOCK],
    [queued.id, queued],
  ]);
  const find = (id: string): Job => {
    const job = jobs.get(id);
    if (job === undefined) throw notFound("job");
    return job;
  };
  return {
    async list() {
      return [...jobs.values()];
    },
    async get(id) {
      return find(id);
    },
    async wait(id) {
      return find(id);
    },
    async cancel(actor, id) {
      const job = find(id);
      if (TERMINAL_JOB_STATUSES.includes(job.status)) throw conflict("job already finished");
      if (actor.role !== "admin" && actor.id !== job.actor.id) throw forbidden("not your job");
      const cancelled: Job = { ...job, cancel_requested: true };
      jobs.set(id, cancelled);
      return cancelled;
    },
    heartbeat() {
      return { alive: true, running: 0, queued: 1, lastTickAt: new Date().toISOString() };
    },
  };
}
