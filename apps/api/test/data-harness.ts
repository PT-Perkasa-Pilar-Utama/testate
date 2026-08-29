import type { Actor, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { PG, createAdaptersHarness, createSettled } from "./adapters.ts";
import type { AdaptersHarness } from "./adapters.ts";
import { createTestSettings } from "./settings.ts";
import { createPoliciesRepository } from "../src/modules/data/data.policies.ts";
import { createDataRepository } from "../src/modules/data/data.repository.ts";
import { createDataService } from "../src/modules/data/data.service.ts";
import type { DataService } from "../src/modules/data/data.service.ts";

export type DataHarness = {
  harness: AdaptersHarness;
  data: DataService;
  adapterId: string;
  viewer: Actor;
};

export async function createDataHarness(): Promise<DataHarness> {
  const harness = await createAdaptersHarness();
  const adapter = await createSettled(harness, PG);
  const data = createDataService({
    engines: harness.engines,
    blobs: harness.blobs,
    ring: harness.ring,
    adapters: harness.repo,
    states: harness.states,
    repo: createDataRepository(harness.db),
    policies: createPoliciesRepository(harness.db),
    projects: harness.projectsRepo,
    jobs: harness.runtime.jobs,
    settings: createTestSettings(harness.db, harness.audit, harness.now),
    audit: harness.audit,
    now: harness.now,
  });
  return { harness, data, adapterId: adapter.id, viewer: { ...harness.qa, role: "viewer" } };
}

export function customersOf(harness: AdaptersHarness): JsonObject[] {
  const rows = harness.databases.get("shop")?.get("public.customers");
  if (rows === undefined) throw new Error("no customers table");
  return rows;
}

export function cursorOf(page: { page: { next_cursor: string | null } }): string {
  if (page.page.next_cursor === null) throw new Error("no next page");
  return page.page.next_cursor;
}

export function harnessStashes(
  harness: AdaptersHarness
): { kind: string; stash_reason: string | null; write_count: number }[] {
  const rows = harness.db
    .query(
      `SELECT s.kind, s.stash_reason, w.write_count FROM states s
       JOIN write_sessions w ON w.stash_state_id = s.id ORDER BY s.created_at`
    )
    .all();
  return v.parse(
    v.array(
      v.object({ kind: v.string(), stash_reason: v.nullable(v.string()), write_count: v.number() })
    ),
    rows
  );
}
