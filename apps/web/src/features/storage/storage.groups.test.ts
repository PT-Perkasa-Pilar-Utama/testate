import { describe, expect, test } from "bun:test";
import type { AdapterWithProject } from "@testate/shared";

import { storeGroups } from "./storage.groups.ts";

// #63, Q3: every tier menu puts Inspect first, and a project page's count filters to its project.
const BASE: AdapterWithProject = {
  id: "s0",
  project_id: "p0",
  project_slug: "shop",
  project_name: "Shop",
  project_kind: "standard",
  kind: "storage",
  engine: "s3",
  tier: "files",
  name: "exports",
  mode: "read_only",
  status: "ok",
  status_message: null,
  config: {},
  credential: { set: false },
  readonly_credential: { set: false },
  excluded_tables: [],
  restore_mode: "atomic",
  lock_timeout_ms: 60000,
  engine_version: null,
  dialect: null,
  capabilities: null,
  strategy: null,
  read_only_enforcement: null,
  last_probe_at: null,
  created_by: null,
  created_by_label: null,
  created_at: "2026-10-10T00:00:00.000Z",
  updated_at: "2026-10-10T00:00:00.000Z",
};

const STORES: AdapterWithProject[] = [
  { ...BASE, id: "s1", name: "a-shop", project_slug: "shop" },
  { ...BASE, id: "s2", name: "b-inspect", project_slug: "inspect", project_kind: "inspect" },
  { ...BASE, id: "s3", name: "c-billing", project_slug: "billing" },
];

describe("the Storage screen's groups", () => {
  test("put Inspect first, and keep to one project when the address names it", () => {
    expect(storeGroups(STORES, "").map((group) => group.slug)).toEqual([
      "inspect",
      "shop",
      "billing",
    ]);
    expect(storeGroups(STORES, "billing").map((group) => group.slug)).toEqual(["billing"]);
  });
});
