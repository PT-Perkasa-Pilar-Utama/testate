import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Actor, Job, JobKind, JsonObject } from "@testate/shared";
import { TERMINAL_JOB_STATUSES } from "@testate/shared";

import type { MetadataDb } from "../../lib/db/index.ts";
import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import { sha256 } from "../../lib/password/index.ts";
import type { Dispatcher, Heartbeat } from "./jobs.dispatcher.ts";
import type { IdempotentRequest } from "./jobs.idempotency.ts";
import type { JobEvent, JobEventHub } from "./jobs.events.ts";
import type { JobsListQuery, JobsRepository } from "./jobs.repository.ts";
import { toJob } from "./jobs.repository.ts";

export type EnqueueInput = {
  kind: JobKind;
  projectId: string | null;
  adapterIds: string[];
  payload: JsonObject;
  actor: Actor;
  parentRequestId: string | null;
  idempotency?: IdempotentRequest;
};

/** What a key lookup found: the hashes to record, and the job the key already made. */
type KeyLookup = { keyHash: string; bodyHash: string; existing: Job | null };

export type JobsFilter = Omit<JobsListQuery, "scope" | "includeInstance">;

export type RecoveryReport = { interrupted: number; head_unknown: number; states_failed: number };

export type JobsService = {
  enqueue(input: EnqueueInput): Promise<Job>;
  /**
   * The job an unexpired `Idempotency-Key` already created for this actor, if any. Services call
   * this before they write anything, so a retry answers with the first job instead of a second one.
   * The same key under a different request conflicts, exactly as it does in `enqueue`.
   */
  replay(request: IdempotentRequest, actor: Actor): Promise<Job | null>;
  get(scope: string[] | null, id: string): Promise<Job>;
  list(
    actor: Actor,
    scope: string[] | null,
    filter: JobsFilter
  ): Promise<{ rows: Job[]; nextCursor: string | null }>;
  wait(scope: string[] | null, id: string, seconds: number): Promise<Job>;
  cancel(actor: Actor, scope: string[] | null, id: string): Promise<Job>;
  /** SSE frames until a terminal status or the signal fires; `afterSeq` replays the last status. */
  events(
    scope: string[] | null,
    id: string,
    afterSeq: number | null,
    signal: AbortSignal
  ): AsyncGenerator<JobEvent | { event: "heartbeat" }>;
  recover(): Promise<RecoveryReport>;
  sweep(historyDays: number): { deleted: number; stubbed: number };
  heartbeat(): Heartbeat;
};

export type JobsDeps = {
  repo: JobsRepository;
  hub: JobEventHub;
  dispatcher: Dispatcher;
  db: MetadataDb;
  dataDir: string;
  now: () => Date;
  heartbeatMs?: number;
};

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const HEAD_UNKNOWN_KINDS = new Set<JobKind>([
  "checkout",
  "import",
  "project_delete",
  "adapter_delete",
]);
const STATE_KINDS = new Set<JobKind>(["snapshot", "diff", "archive_import"]);

/** The first frame of a stream: the last status unless the client already saw it (14 §14.5). */
function replay(last: JobEvent | null, afterSeq: number | null, job: Job): JobEvent | null {
  if (last === null) return { seq: 0, event: "status", data: job };
  if (afterSeq !== null && last.seq <= afterSeq) return null;
  return last;
}

function isTerminal(job: Job): boolean {
  return TERMINAL_JOB_STATUSES.includes(job.status);
}

export function createJobsService(deps: JobsDeps): JobsService {
  const { repo, hub, dispatcher } = deps;
  const nowIso = (): string => deps.now().toISOString();

  const visible = (scope: string[] | null, id: string): Job => {
    const job = repo.byId(id);
    if (job === null) throw notFound("job");
    if (scope !== null && (job.project_id === null || !scope.includes(job.project_id)))
      throw notFound("job");
    return toJob(job);
  };

  const recorded = (request: IdempotentRequest, actor: Actor): KeyLookup => {
    const keyHash = sha256(request.key);
    const bodyHash = sha256(JSON.stringify({ kind: request.kind, body: request.body }));
    const found = repo.findIdempotency(keyHash, actor.id);
    if (found === null) return { keyHash, bodyHash, existing: null };
    if (found.expires_at <= nowIso()) {
      repo.deleteIdempotency(keyHash, actor.id);
      return { keyHash, bodyHash, existing: null };
    }
    if (found.body_hash !== bodyHash)
      throw conflict("Idempotency-Key was used with a different request");
    const job = repo.byId(found.job_id);
    return { keyHash, bodyHash, existing: job === null ? null : toJob(job) };
  };

  const waitFor = (id: string, seconds: number): Promise<Job> =>
    new Promise((resolve) => {
      const current = repo.byId(id);
      if (current === null || isTerminal(current)) {
        resolve(toJob(current ?? { ...visibleOrThrow(id), payload: {} }));
        return;
      }
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(visibleOrThrow(id));
      }, seconds * 1000);
      const unsubscribe = hub.subscribe(id, (event) => {
        if (event.event !== "status" || !isTerminal(event.data)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(event.data);
      });
    });
  const visibleOrThrow = (id: string): Job => {
    const job = repo.byId(id);
    if (job === null) throw notFound("job");
    return toJob(job);
  };

  return {
    async enqueue(input) {
      const idem =
        input.idempotency === undefined ? null : recorded(input.idempotency, input.actor);
      if (idem?.existing) return idem.existing;
      const claimed = repo.claimedAdapterIds();
      const busy = input.adapterIds.find((id) => claimed.has(id));
      if (busy !== undefined)
        throw new AppError("JOB_IN_PROGRESS", "an adapter of this job is busy", {
          adapter_id: busy,
        });
      const job = repo.insert({
        id: Bun.randomUUIDv7(),
        kind: input.kind,
        project_id: input.projectId,
        adapter_ids: input.adapterIds,
        payload: input.payload,
        actor: input.actor,
        parent_request_id: input.parentRequestId,
        created_at: nowIso(),
      });
      if (idem !== null) {
        repo.insertIdempotency(
          idem.keyHash,
          input.actor.id,
          job.id,
          idem.bodyHash,
          new Date(deps.now().getTime() + IDEMPOTENCY_TTL_MS).toISOString()
        );
      }
      dispatcher.poke();
      return toJob(job);
    },
    async replay(request, actor) {
      return recorded(request, actor).existing;
    },
    async get(scope, id) {
      return visible(scope, id);
    },
    async list(actor, scope, filter) {
      return repo.list({ ...filter, scope, includeInstance: actor.role === "admin" });
    },
    async wait(scope, id, seconds) {
      visible(scope, id);
      return waitFor(id, seconds);
    },
    async cancel(actor, scope, id) {
      const job = visible(scope, id);
      if (isTerminal(job)) throw conflict("job already finished");
      if (actor.role !== "admin" && actor.id !== job.actor.id) throw forbidden("not your job");
      repo.requestCancel(id);
      if (!dispatcher.abort(id)) {
        // Still queued: nothing runs, so the cancel is final now.
        repo.finish(
          id,
          "cancelled",
          null,
          { code: "CONFLICT", message: "cancelled before start" },
          nowIso()
        );
        hub.publishStatus(visibleOrThrow(id));
      }
      return visibleOrThrow(id);
    },
    async *events(scope, id, afterSeq, signal) {
      const job = visible(scope, id);
      const queue: (JobEvent | { event: "heartbeat" })[] = [];
      let wake: (() => void) | null = null;
      const push = (item: JobEvent | { event: "heartbeat" }): void => {
        queue.push(item);
        wake?.();
      };
      const unsubscribe = hub.subscribe(id, push);
      const beat = setInterval(() => push({ event: "heartbeat" }), deps.heartbeatMs ?? 15000);
      const stop = (): void => {
        unsubscribe();
        clearInterval(beat);
      };
      signal.addEventListener("abort", () => {
        stop();
        wake?.();
      });
      try {
        const opening = replay(hub.lastStatus(id), afterSeq, job);
        if (opening !== null) yield opening;
        if (isTerminal(job)) return;
        while (!signal.aborted) {
          const item = queue.shift();
          if (item === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
            continue;
          }
          yield item;
          if (item.event === "status" && isTerminal(item.data)) return;
        }
      } finally {
        stop();
      }
    },
    async recover() {
      const interrupted = repo.interruptRunning(nowIso());
      let headUnknown = 0;
      let statesFailed = 0;
      for (const job of interrupted) {
        const counters = job.progress?.["phase"] === "counters";
        if (job.project_id !== null && (HEAD_UNKNOWN_KINDS.has(job.kind) || counters)) {
          headUnknown += deps.db
            .query("UPDATE projects SET head_status = 'unknown', head_changed_at = ? WHERE id = ?")
            .run(nowIso(), job.project_id).changes;
        }
        if (STATE_KINDS.has(job.kind)) {
          statesFailed += deps.db
            .query("UPDATE states SET status = 'failed' WHERE job_id = ? AND status = 'creating'")
            .run(job.id).changes;
        }
        deps.db.query("DELETE FROM blob_pins WHERE job_id = ?").run(job.id);
        rmSync(join(deps.dataDir, "uploads", job.id), { recursive: true, force: true });
      }
      return {
        interrupted: interrupted.length,
        head_unknown: headUnknown,
        states_failed: statesFailed,
      };
    },
    sweep(historyDays) {
      return repo.sweep(
        new Date(deps.now().getTime() - historyDays * 24 * 60 * 60 * 1000).toISOString()
      );
    },
    heartbeat: () => dispatcher.heartbeat(),
  };
}
