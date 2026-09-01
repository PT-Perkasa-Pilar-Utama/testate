import * as v from "valibot";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { conflict, notFound } from "../../lib/http/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";
import type { StatesRepository } from "./states.repository.ts";

export type DeleteDeps = {
  states: StatesRepository;
  blobs: BlobStore;
  audit: AuditService;
};

const payloadSchema = v.object({ state_id: v.string(), name: v.string(), slug: v.string() });

/**
 * The `state_delete` job (15 §15.4): metadata transaction first, then the blobs nobody references
 * and no job pins. HEAD drops to `none` when the deleted state was HEAD (08 §8.6).
 */
export function createStateDeleteRunner(deps: DeleteDeps): JobRunner {
  return async ({ job, progress }) => {
    const payload = v.parse(payloadSchema, job.payload);
    const projectId = job.project_id ?? "";
    const state = deps.states.byIdOrName(projectId, payload.state_id);
    if (state === null) throw notFound("state");
    if (state.protected || state.kind === "init") {
      throw conflict("state is protected", { state_id: state.id });
    }
    progress({ phase: "metadata" });
    const removal = deps.states.remove(state.id);
    progress({ phase: "gc", candidates: removal.orphans.length });
    const orphans = deps.states.unpinnedOrphans(removal.orphans);
    for (const hash of orphans) await deps.blobs.delete(hash);
    deps.states.forgetBlobs(orphans);
    deps.audit.record({
      actor: job.actor,
      action: "state.deleted",
      target_type: "state",
      target_id: state.id,
      target_label: state.name,
      project: { id: projectId, slug: payload.slug },
      details: { name: state.name, blobs_deleted: orphans.length, head_cleared: removal.wasHead },
      outcome: "succeeded",
    });
    return {
      status: "succeeded",
      result: { blobs_deleted: orphans.length, head_cleared: removal.wasHead },
    };
  };
}
