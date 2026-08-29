import { expect } from "bun:test";
import { TEST_META } from "./accounts.ts";
import { createAdaptersHarness } from "./adapters.ts";
import type { AdaptersHarness } from "./adapters.ts";
import { createStatesService } from "../src/modules/states/states.service.ts";
import type { StatesService } from "../src/modules/states/states.service.ts";

export type StatesHarness = { harness: AdaptersHarness; states: StatesService };

export const LIST = {
  limit: 50,
  sort: "created_at" as const,
  order: "asc" as const,
  includeStash: false,
};

export async function createStatesHarness(): Promise<StatesHarness> {
  const harness = await createAdaptersHarness();
  const states = createStatesService({
    repo: harness.states,
    projects: harness.projectsRepo,
    adapters: harness.repo,
    jobs: harness.runtime.jobs,
    blobs: harness.blobs,
    uploads: harness.imports,
    audit: harness.audit,
    now: harness.now,
    createAdapter: async (actor, project, draft, meta) =>
      (await harness.adapters.create(actor, project.slug, draft, meta)).adapter,
  });
  return { harness, states };
}

export async function snapshotSettled(
  h: StatesHarness,
  name: string,
  tags: string[] = []
): Promise<string> {
  const { state, job } = await h.states.snapshot(h.harness.qa, "shop", { name, tags }, TEST_META);
  const done = await h.harness.runtime.jobs.wait(null, job.id, 5);
  expect(done.error).toBeNull();
  return state.id;
}

export function initIdOf(harness: AdaptersHarness, adapterId: string): string {
  const init = harness.states.latestInit(adapterId);
  if (init === null) throw new Error("no init state");
  return init.state_id;
}
