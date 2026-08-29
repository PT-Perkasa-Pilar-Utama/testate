import { describe, expect, it } from "bun:test";
import type { Adapter, AdapterDraft, Project, User } from "@testate/shared";

import { createSeeds, devAdapters } from "./ops.seeds.ts";
import type { SeedDeps } from "./ops.seeds.ts";

type Calls = { users: string[]; projects: string[]; adapters: string[]; states: string[] };

/** Service stubs that count calls; the adapter named in `refuse` fails like an unreachable engine. */
function stubDeps(calls: Calls, refuse: string | null): SeedDeps {
  return {
    users: {
      create: async (_actor, input) => {
        calls.users.push(input.username);
        // SAFETY: the seed reads nothing back from the created user.
        return { username: input.username } as User;
      },
    },
    projects: {
      create: async (_actor, input) => {
        calls.projects.push(input.slug);
        // SAFETY: the seed uses only the slug of the created project.
        return { slug: input.slug, id: "p1" } as Project;
      },
    },
    adapters: {
      create: async (_actor, _slug, draft: AdapterDraft) => {
        if (draft.name === refuse) throw new Error("connection refused");
        calls.adapters.push(draft.name);
        // SAFETY: the seed ignores the created adapter.
        return { adapter: { id: draft.name } as Adapter, init_job: null };
      },
    },
    states: {
      snapshot: async (_actor, _slug, input) => {
        calls.states.push(input.name);
        // SAFETY: the seed reads nothing back from the snapshot.
        return { state: { id: "s1" }, job: { id: "j1" } } as Awaited<
          ReturnType<SeedDeps["states"]["snapshot"]>
        >;
      },
    },
    admin: () => ({ id: "u1", username: "admin", role: "admin" }),
    selfUrl: "http://127.0.0.1:3000",
  };
}

function targetOf(draft: AdapterDraft): string {
  const target =
    draft.config["port"] ?? draft.config["endpoint"] ?? draft.config["base_url"] ?? "url";
  return `${draft.engine}:${String(target)}`;
}

describe("reset seeds", () => {
  it("dev seeds users, the demo project, the compose adapters, and one state; a refused adapter is a warning", async () => {
    const calls: Calls = { users: [], projects: [], adapters: [], states: [] };
    const seed = createSeeds(stubDeps(calls, "shop-mongo"));
    const counts = await seed("dev");
    expect(calls.users).toEqual(["qa", "viewer"]);
    expect(calls.projects).toEqual(["demo"]);
    expect(calls.adapters).toEqual([
      "shop-postgres",
      "shop-mysql",
      "shop-mariadb",
      "exports",
      "self-health",
    ]);
    expect(calls.states).toEqual(["seeded-baseline"]);
    expect(counts).toEqual({
      users: 3,
      projects: 1,
      adapters: 5,
      states: 1,
      warnings: ["shop-mongo: connection refused"],
    });
  });

  it("qa seeds nothing beyond the bootstrap admin, and the dev adapters name the compose ports", async () => {
    const calls: Calls = { users: [], projects: [], adapters: [], states: [] };
    const counts = await createSeeds(stubDeps(calls, null))("qa");
    expect(counts).toEqual({ users: 1, projects: 0, adapters: 0, states: 0, warnings: [] });
    expect(calls.adapters).toEqual([]);
    const drafts = devAdapters("http://127.0.0.1:3000");
    expect(drafts.map(targetOf)).toEqual([
      "postgres:54320",
      "mysql:33060",
      "mariadb:33070",
      "mongodb:url",
      "s3:http://127.0.0.1:9010",
      "http:http://127.0.0.1:3000/api/v1/health/live",
    ]);
  });
});
