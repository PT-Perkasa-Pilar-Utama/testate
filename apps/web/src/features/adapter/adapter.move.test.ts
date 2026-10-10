import { describe, expect, test } from "bun:test";
import type { Head, Project } from "@testate/shared";

import { leavesHistory, moveOptions } from "./adapter.move.rules.ts";

// #77 (M1–M3 of docs/decisions/2026-10-10-move-adapter.md): never the adapter's own project; a
// database only into a project at its starting point; no ingest adapter into Inspect.
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

const PROJECTS = [
  project("shop"),
  project("billing", MOVED),
  project("inspect", AT_START, "inspect"),
];

const pick = (options: ReturnType<typeof moveOptions>) =>
  options.map((option) => `${option.value}:${option.disabled ? "off" : "on"}:${option.label}`);

describe("where an adapter can move", () => {
  test("a database: Inspect first, never its own project, and not into a project that moved on", () => {
    expect(pick(moveOptions({ kind: "database", engine: "postgres" }, PROJECTS, "shop"))).toEqual([
      "inspect:on:INSPECT",
      "billing:off:BILLING (not at its starting point)",
    ]);
  });

  test("a file store goes anywhere else, by name", () => {
    expect(pick(moveOptions({ kind: "storage", engine: "s3" }, PROJECTS, "shop"))).toEqual([
      "inspect:on:INSPECT",
      "billing:on:BILLING",
    ]);
  });

  test("an ingest adapter is offered Inspect greyed out, with the reason", () => {
    expect(pick(moveOptions({ kind: "logs", engine: "ingest" }, PROJECTS, "shop"))).toEqual([
      "inspect:off:INSPECT (stores no pushed logs)",
      "billing:on:BILLING",
    ]);
  });
});

describe("the warning before a move", () => {
  test("shows for a database leaving a regular project, and nothing else", () => {
    expect([
      leavesHistory({ kind: "database" }, false),
      leavesHistory({ kind: "database" }, true),
      leavesHistory({ kind: "storage" }, false),
    ]).toEqual([true, false, false]);
  });
});
