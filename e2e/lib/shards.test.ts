import { readdirSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { PROJECTS, SHARDS, inputsOf, projectsFor, shardsOfSpec, spaFor } from "./shards.ts";

const sharded: string[] = Object.values(SHARDS).flat();

describe("splitting the suite into CI shards", () => {
  test("every project sits in exactly one shard, so none is run twice or never", () => {
    expect([...sharded].sort()).toEqual(PROJECTS.map((project) => project.name).sort());
  });

  test("every spec file belongs to a shard", () => {
    const specs = readdirSync(new URL("..", import.meta.url).pathname).filter((name) =>
      name.endsWith(".e2e.ts")
    );
    const orphans = specs.filter((name) => shardsOfSpec(`e2e/${name}`).length === 0);
    expect(orphans).toEqual([]);
  });

  test("a shard keeps the chain order inside it, through projects outside it", () => {
    const states = projectsFor("states");
    // boot waits for the crawl in the full chain; the crawl waits for adapter.
    expect(states.map((project) => [project.name, project.dependencies])).toEqual([
      ["states", []],
      ["state-api", ["states"]],
      ["adapter", ["state-api"]],
      ["boot", ["adapter"]],
    ]);
  });

  test("a project whose whole chain is in other shards starts first", () => {
    expect(projectsFor("tail").map((project) => [project.name, project.dependencies])).toEqual([
      ["crawl", []],
      ["screens", []],
      ["stress", []],
    ]);
  });

  test("only the bundle walk drives the production build", () => {
    expect(spaFor("bundle")).toBe("production");
    expect(spaFor("tail")).toBe("development");
    expect(spaFor(undefined)).toBe("development");
  });

  test("unset, the whole chain runs; an unknown shard is refused", () => {
    expect(projectsFor(undefined)).toBe(PROJECTS);
    expect(() => projectsFor("everything")).toThrow("E2E_SHARD=everything is not one of");
  });
});

describe("what a shard's pass depends on", () => {
  const tracked = [
    "apps/web/src/app.tsx",
    "docs/E2E.md",
    "README.md",
    "e2e/lib/api.ts",
    "e2e/states.e2e.ts",
    "e2e/flows.e2e.ts",
    ".github/workflows/ci.yml",
  ];

  test("the app, the shared helpers and the workflow count for every shard", () => {
    expect(inputsOf("flows", tracked)).toContain("apps/web/src/app.tsx");
    expect(inputsOf("tail", tracked)).toContain("e2e/lib/api.ts");
    expect(inputsOf("screens", tracked)).toContain(".github/workflows/ci.yml");
  });

  test("a shard ignores the documentation and the specs only other shards run", () => {
    expect(inputsOf("flows", tracked)).toEqual([
      "apps/web/src/app.tsx",
      "e2e/lib/api.ts",
      "e2e/flows.e2e.ts",
      ".github/workflows/ci.yml",
    ]);
    expect(inputsOf("states", tracked)).toContain("e2e/states.e2e.ts");
    expect(inputsOf("states", tracked)).not.toContain("e2e/flows.e2e.ts");
  });

  test("api.e2e.ts belongs to the screens shard and state-api.e2e.ts to the states shard", () => {
    expect(shardsOfSpec("e2e/api.e2e.ts")).toEqual(["screens"]);
    expect(shardsOfSpec("e2e/state-api.e2e.ts")).toEqual(["states"]);
  });
});
