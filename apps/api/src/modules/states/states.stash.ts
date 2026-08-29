import type { Actor } from "@testate/shared";

import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import type { AdapterManifest } from "./states.manifests.ts";
import { snapshotAdapter } from "./states.snapshot.ts";
import type { SnapshotDeps } from "./states.snapshot.ts";

export type StashReason = "checkout" | "import" | "write-session";

export type StashInput = {
  projectId: string;
  adapters: AdapterRecord[];
  reason: StashReason;
  jobId: string;
  actor: Actor;
  signal: AbortSignal;
};

/**
 * A stash is a state of kind `stash` taken inside the caller's job before any destructive step
 * (05 §5.8). Parented on HEAD; HEAD does not move. Returns the state id.
 * ponytail: stashes are never pruned — `pruneStashes` waits for the settings card's keep count.
 */
export async function takeStash(deps: SnapshotDeps, input: StashInput): Promise<string> {
  const at = deps.now();
  const stateId = Bun.randomUUIDv7();
  const project = deps.projects.byId(input.projectId);
  deps.states.insert({
    id: stateId,
    project_id: input.projectId,
    name: `stash-${at.toISOString().replace(/[:.]/g, "-")}-${stateId.slice(-4)}`,
    kind: "stash",
    protected: false,
    parent_state_id: project?.head.state_id ?? null,
    stash_reason: input.reason,
    job_id: input.jobId,
    actor: input.actor,
    created_at: at.toISOString(),
  });
  try {
    const manifests: AdapterManifest[] = [];
    for (const adapter of input.adapters) {
      manifests.push(
        await snapshotAdapter(deps, adapter, input.jobId, input.signal, () => undefined)
      );
    }
    deps.states.commitManifest(stateId, manifests, deps.now().toISOString());
    return stateId;
  } catch (cause: unknown) {
    deps.states.setStatus(stateId, "failed", deps.now().toISOString());
    throw cause;
  }
}
