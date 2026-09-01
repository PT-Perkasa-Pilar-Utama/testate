import { describe, expect, it } from "bun:test";

import { createAccounts } from "../../../test/accounts.ts";
import { QA_ACTOR } from "../../lib/mock/fixtures.ts";
import { createStatesRepository } from "./states.repository.ts";
import type { NewState, StatesFilter } from "./states.repository.ts";

const BASE: Omit<StatesFilter, "limit" | "created_from" | "created_to"> = {
  sort: "created_at",
  order: "asc",
  includeStash: false,
};

function state(id: string, projectId: string, name: string, createdAt: string): NewState {
  return {
    id,
    project_id: projectId,
    name,
    kind: "manual",
    protected: false,
    parent_state_id: null,
    job_id: "01991f00-0000-7000-8000-0000000000j1",
    actor: { ...QA_ACTOR },
    created_at: createdAt,
  };
}

describe("states created-date range", () => {
  it("list() keeps a row inside the range and drops one outside it", async () => {
    const { db, admin, projectsRepo } = await createAccounts();
    const project = projectsRepo.insert({
      id: "01991f00-0000-7000-8000-0000000000p1",
      slug: "shop",
      name: "Shop",
      description: null,
      quota_bytes: null,
      created_by: admin.id,
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const repo = createStatesRepository(db);
    repo.insert(
      state(
        "01991f00-0000-7000-8000-0000000000s1",
        project.id,
        "golden",
        "2026-08-29T12:00:00.000Z"
      )
    );
    repo.insert(
      state(
        "01991f00-0000-7000-8000-0000000000s2",
        project.id,
        "silver",
        "2026-09-02T12:00:00.000Z"
      )
    );
    const inRange = repo.list(project.id, {
      ...BASE,
      limit: 10,
      created_from: "2026-08-28",
      created_to: "2026-08-30",
    });
    expect(inRange.map((row) => row.name)).toStrictEqual(["golden"]);
    const outOfRange = repo.list(project.id, { ...BASE, limit: 10, created_from: "2026-09-03" });
    expect(outOfRange).toStrictEqual([]);
  });
});
