import type { Actor, Job } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import type { StatesRepository } from "../states/states.repository.ts";
import { initName } from "../states/states.snapshot.ts";
import type { AdapterRecord } from "./adapters.repository.ts";

export type InitDeps = {
  states: Pick<StatesRepository, "insert" | "nameTaken" | "update" | "initOf">;
  jobs: Pick<JobsService, "enqueue">;
  now: () => Date;
};

/**
 * A database adapter's baseline goes into the project's one init state (05 §5.3 step 4): the
 * first database creates it, every later one is snapshotted into it, and a retarget replaces
 * that database's entry. One root for the history, and one place a deletion restores from.
 *
 * The row exists before the job, as a manual state's does: a states list opened between "init
 * snapshot queued" and the runner picking the job up had nothing to show and nothing to follow.
 */
export function createInitJob(
  deps: InitDeps
): (adapter: AdapterRecord, actor: Actor, meta: RequestMeta) => Promise<Job | null> {
  const nowIso = (): string => deps.now().toISOString();
  return async (adapter, actor, meta) => {
    if (adapter.kind !== "database") return null;
    const existing = deps.states.initOf(adapter.project_id);
    const stateId = existing?.id ?? Bun.randomUUIDv7();
    if (existing === null) {
      deps.states.insert({
        id: stateId,
        project_id: adapter.project_id,
        name: initName(deps.states, adapter.project_id, adapter),
        kind: "init",
        protected: true,
        parent_state_id: null,
        job_id: "",
        actor,
        created_at: nowIso(),
      });
    }
    const job = await deps.jobs.enqueue({
      kind: "snapshot",
      projectId: adapter.project_id,
      adapterIds: [adapter.id],
      payload: { state_id: stateId, adapter_ids: [adapter.id] },
      actor,
      parentRequestId: meta.request_id,
    });
    deps.states.update(stateId, { job_id: job.id }, nowIso());
    return job;
  };
}
