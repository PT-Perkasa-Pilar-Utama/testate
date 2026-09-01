import { describe, expect, it } from "bun:test";

import { createTestDb } from "../../../test/db.ts";
import { QA_ACTOR } from "../../lib/mock/fixtures.ts";
import { createJobsRepository } from "./jobs.repository.ts";
import type { JobsListQuery, NewJob } from "./jobs.repository.ts";

const BASE: Omit<JobsListQuery, "limit" | "created_from" | "created_to"> = {
  sort: "created_at",
  order: "asc",
  scope: null,
  includeInstance: true,
};

function job(id: string, createdAt: string): NewJob {
  return {
    id,
    kind: "snapshot",
    project_id: null,
    adapter_ids: [],
    payload: {},
    actor: { ...QA_ACTOR },
    parent_request_id: null,
    created_at: createdAt,
  };
}

describe("jobs created-date range", () => {
  it("list() keeps a row inside the range and drops one outside it", () => {
    const repo = createJobsRepository(createTestDb());
    repo.insert(job("01991f00-0000-7000-8000-0000000000j1", "2026-08-29T12:00:00.000Z"));
    repo.insert(job("01991f00-0000-7000-8000-0000000000j2", "2026-09-02T12:00:00.000Z"));
    const inRange = repo.list({
      ...BASE,
      limit: 10,
      created_from: "2026-08-28",
      created_to: "2026-08-30",
    });
    expect(inRange.rows.map((row) => row.id)).toStrictEqual([
      "01991f00-0000-7000-8000-0000000000j1",
    ]);
    const outOfRange = repo.list({ ...BASE, limit: 10, created_from: "2026-09-03" });
    expect(outOfRange.rows).toStrictEqual([]);
  });

  it("total() counts every row the range matches, not just the page", () => {
    const repo = createJobsRepository(createTestDb());
    repo.insert(job("01991f00-0000-7000-8000-0000000000j3", "2026-08-29T01:00:00.000Z"));
    // Right at the end of the "to" day: still inside, because the bound compares against
    // 23:59:59.999 of that day rather than its midnight.
    repo.insert(job("01991f00-0000-7000-8000-0000000000j4", "2026-08-30T23:59:00.000Z"));
    repo.insert(job("01991f00-0000-7000-8000-0000000000j5", "2026-09-02T12:00:00.000Z"));
    const range = { ...BASE, limit: 1, created_from: "2026-08-28", created_to: "2026-08-30" };
    expect(repo.list(range).rows.length).toBe(1);
    expect(repo.total(range)).toBe(2);
    expect(repo.total({ ...BASE, limit: 1, created_from: "2026-09-01" })).toBe(1);
  });
});
