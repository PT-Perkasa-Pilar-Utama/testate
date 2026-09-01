// The fixture both agent suites run on: one settled Postgres adapter, a masked column, and
// two contexts, a viewer agent token and a tester one.
import type { Actor, JsonObject, JsonValue } from "@testate/shared";
import { PG, createAdaptersHarness, createSettled } from "../../../test/adapters.ts";
import * as v from "valibot";

import { TEST_META } from "../../../test/accounts.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { createTestSettings } from "../../../test/settings.ts";
import { createCheckoutsService } from "../checkouts/checkouts.service.ts";
import { createPoliciesRepository } from "../data/data.policies.ts";
import { createDataRepository } from "../data/data.repository.ts";
import { createDataService } from "../data/data.service.ts";
import { createDiffsService } from "../diffs/diffs.service.ts";
import { createProjectsService } from "../projects/projects.service.ts";
import { createStatesService } from "../states/states.service.ts";
import { createStorageService } from "../storage/storage.service.ts";
import type { AgentContext, AgentRuntime } from "./agent.service.ts";
import { createAgentTools } from "./agent.tools.ts";

export type Harness = {
  harness: AdaptersHarness;
  runtime: AgentRuntime;
  adapterId: string;
  /** A viewer agent token, which is what every agent token used to be. */
  ctx: AgentContext;
  /** An agent token with the tester role (23 §23.6). */
  tester: AgentContext;
};

export async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const adapter = await createSettled(harness, PG);
  const settings = createTestSettings(harness.db, harness.audit, harness.now);
  const policies = createPoliciesRepository(harness.db);
  policies.upsert(
    adapter.id,
    {
      table: "public.customers",
      column: "email",
      required_function: null,
      mask: "redact",
      display: false,
    },
    harness.qa.id,
    "2026-08-29T00:00:00.000Z"
  );
  const shared = {
    engines: harness.engines,
    blobs: harness.blobs,
    ring: harness.ring,
    adapters: harness.repo,
    states: harness.states,
    projects: harness.projectsRepo,
    jobs: harness.runtime.jobs,
    audit: harness.audit,
    now: harness.now,
  };
  const data = createDataService({
    ...shared,
    repo: createDataRepository(harness.db),
    policies,
    settings,
  });
  const states = createStatesService({ ...shared, repo: harness.states, uploads: harness.imports });
  const checkouts = createCheckoutsService({
    ...shared,
    repo: harness.checkouts,
    engines: harness.engines,
  });
  const diffs = createDiffsService({ ...shared, repo: harness.diffs, policies, settings });
  const projects = createProjectsService({
    repo: harness.projectsRepo,
    audit: harness.audit,
    settings,
    adapters: harness.adapters,
    jobs: harness.runtime.jobs,
    now: harness.now,
  });
  const runtime = createAgentTools({
    projects,
    projectsRepo: harness.projectsRepo,
    adapters: harness.adapters,
    adaptersRepo: harness.repo,
    data,
    states,
    diffs,
    storage: createStorageService({
      projects: harness.projectsRepo,
      files: harness.files,
      hostKeys: harness.hostKeys,
      audit: harness.audit,
      now: harness.now,
    }),
    audit: harness.audit,
    checkouts,
    jobs: harness.runtime.jobs,
  });
  const actor: Actor = {
    kind: "token",
    id: "01991f00-0000-7000-8000-0000000000a0",
    label: "token:agent",
    role: "viewer",
    agent: true,
  };
  // A real row, because a write session now points at one: the token that holds the session has to
  // exist for the same reason the user that holds one always did (0004).
  const testerId = "01991f00-0000-7000-8000-0000000000a1";
  harness.db
    .query(
      `INSERT INTO api_tokens (id, name, role, kind, token_hash, prefix, created_at)
       VALUES (?, 'tester-agent', 'qa', 'agent', ?, 'tst_test', '2026-08-29T00:00:00.000Z')`
    )
    .run(testerId, `hash-${testerId}`);
  const tester: AgentContext = {
    actor: { ...actor, id: testerId, role: "qa" },
    scope: null,
    meta: TEST_META,
  };
  return {
    harness,
    runtime,
    adapterId: adapter.id,
    ctx: { actor, scope: null, meta: TEST_META },
    tester,
  };
}

export function call(
  h: Harness,
  tool: string,
  args: JsonObject,
  ctx: AgentContext = h.ctx
): Promise<JsonValue> {
  return h.runtime.runTool(tool, args, ctx);
}

export const rowsResult = v.object({
  rows: v.array(v.record(v.string(), v.any())),
  next_cursor: v.nullable(v.string()),
  masked_columns: v.array(v.string()),
});
export const rowResult = v.object({
  row: v.record(v.string(), v.any()),
  parents: v.record(v.string(), v.array(v.record(v.string(), v.any()))),
  masked_columns: v.array(v.string()),
});

export function uriAt(resources: { uri: string }[], index: number): string {
  const resource = resources[index];
  if (resource === undefined) throw new Error(`no resource ${index}`);
  return resource.uri;
}
