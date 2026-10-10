import { describe, expect, test } from "bun:test";
import type { AdapterWithProject, Head, Project } from "@testate/shared";

import {
  databasesRedirect,
  firstPickable,
  groupByProject,
  pickerOptions,
  readQuery,
} from "./databases.presenter.ts";

// docs/decisions/2026-10-10-databases-menu.md: the Databases screen groups by project, Inspect
// first, and keeps a project off the picker's usable list while it is not at its starting point.
const AT_START: Head = {
  status: "known",
  state_id: null,
  state_name: null,
  changed_at: null,
  dirty: false,
};
const MOVED: Head = { ...AT_START, state_id: "s9", state_name: "after-refund" };

function project(slug: string, head: Head = AT_START, kind: Project["kind"] = "standard"): Project {
  return {
    id: `id-${slug}`,
    slug,
    kind,
    name: slug.toUpperCase(),
    description: null,
    quota_bytes: null,
    head,
    created_by: "u1",
    created_by_label: "admin",
    created_at: "2026-10-10T00:00:00.000Z",
    updated_at: "2026-10-10T00:00:00.000Z",
  };
}

function database(name: string, slug: string): AdapterWithProject {
  return {
    id: `a-${name}`,
    project_id: `id-${slug}`,
    project_slug: slug,
    project_name: slug.toUpperCase(),
    project_kind: slug === "inspect" ? "inspect" : "standard",
    kind: "database",
    engine: "postgres",
    tier: "tabular",
    name,
    mode: "sandbox",
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
}

const PROJECTS = [
  project("billing"),
  project("inspect", AT_START, "inspect"),
  project("shop", MOVED),
];
const ROWS = [database("orders", "shop"), database("ro", "inspect"), database("ledger", "billing")];

describe("the Databases screen", () => {
  test("groups by project, Inspect first, and leaves out projects with no database", () => {
    const groups = groupByProject(ROWS, [...PROJECTS, project("empty")], "");
    expect(groups.map((g) => [g.slug, g.rows.map((r) => r.name), g.atStart])).toEqual([
      ["inspect", ["ro"], true],
      ["billing", ["ledger"], true],
      ["shop", ["orders"], false],
    ]);
  });

  test("filtered to one project shows that group, even when it has no database yet", () => {
    expect(groupByProject(ROWS, PROJECTS, "shop").map((g) => g.slug)).toEqual(["shop"]);
    const empty = groupByProject(ROWS, [...PROJECTS, project("empty")], "empty");
    expect(empty.map((g) => [g.slug, g.rows.length])).toEqual([["empty", 0]]);
  });

  test("greys out a project not at its starting point, and says why", () => {
    const options = pickerOptions(PROJECTS);
    expect(options.map((o) => [o.value, o.disabled, o.label])).toEqual([
      ["inspect", false, "INSPECT"],
      ["billing", false, "BILLING"],
      ["shop", true, "SHOP (not at its starting point)"],
    ]);
    expect([firstPickable(options, "shop"), firstPickable(options, "billing")]).toEqual([
      "inspect",
      "billing",
    ]);
  });

  test("reads the project filter and the create preset from the address", () => {
    expect([readQuery("?project=shop&new=1"), readQuery("")]).toEqual([
      { project: "shop", create: true },
      { project: "", create: false },
    ]);
  });
});

describe("a link to the old Databases tab", () => {
  test("lands on the Databases menu filtered to the project, and nothing else redirects", () => {
    expect([
      databasesRedirect("?tab=adapters", "shop"),
      databasesRedirect("?tab=states", "shop"),
      databasesRedirect("", "shop"),
    ]).toEqual(["/databases?project=shop", null, null]);
  });
});
