import { describe, expect, it } from "bun:test";

import { createAccounts } from "../../../test/accounts.ts";
import { QA_ACTOR } from "../../lib/mock/fixtures.ts";
import { createCheckoutsRepository } from "./checkouts.repository.ts";
import type { CheckoutsFilter, NewCheckout } from "./checkouts.repository.ts";

const BASE: Omit<CheckoutsFilter, "limit" | "created_from" | "created_to"> = {
  sort: "created_at",
  order: "asc",
};

function checkout(id: string, projectId: string, createdAt: string): NewCheckout {
  return {
    id,
    project_id: projectId,
    state_id: "01991f00-0000-7000-8000-0000000000s1",
    job_id: "01991f00-0000-7000-8000-0000000000j1",
    force: false,
    purpose: "checkout",
    adapter_ids: [],
    actor: { ...QA_ACTOR },
    created_at: createdAt,
  };
}

describe("checkouts created-date range", () => {
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
    const repo = createCheckoutsRepository(db);
    repo.insert(
      checkout("01991f00-0000-7000-8000-0000000000c1", project.id, "2026-08-29T12:00:00.000Z")
    );
    repo.insert(
      checkout("01991f00-0000-7000-8000-0000000000c2", project.id, "2026-09-02T12:00:00.000Z")
    );
    const inRange = repo.list(project.id, {
      ...BASE,
      limit: 10,
      created_from: "2026-08-28",
      created_to: "2026-08-30",
    });
    expect(inRange.map((row) => row.id)).toStrictEqual(["01991f00-0000-7000-8000-0000000000c1"]);
    const outOfRange = repo.list(project.id, { ...BASE, limit: 10, created_from: "2026-09-03" });
    expect(outOfRange).toStrictEqual([]);
  });

  it("total() counts every row the range matches, not just the page", async () => {
    const { db, admin, projectsRepo } = await createAccounts();
    const project = projectsRepo.insert({
      id: "01991f00-0000-7000-8000-0000000000p2",
      slug: "billing",
      name: "Billing",
      description: null,
      quota_bytes: null,
      created_by: admin.id,
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const repo = createCheckoutsRepository(db);
    repo.insert(
      checkout("01991f00-0000-7000-8000-0000000000c3", project.id, "2026-08-29T01:00:00.000Z")
    );
    // Right at the end of the "to" day: still inside, because the bound compares against
    // 23:59:59.999 of that day rather than its midnight.
    repo.insert(
      checkout("01991f00-0000-7000-8000-0000000000c4", project.id, "2026-08-30T23:59:00.000Z")
    );
    repo.insert(
      checkout("01991f00-0000-7000-8000-0000000000c5", project.id, "2026-09-02T12:00:00.000Z")
    );
    const range = { ...BASE, limit: 1, created_from: "2026-08-28", created_to: "2026-08-30" };
    expect(repo.list(project.id, range).length).toBe(1);
    expect(repo.total(project.id, range)).toBe(2);
    expect(repo.total(project.id, { ...BASE, limit: 1, created_from: "2026-09-01" })).toBe(1);
  });
});
