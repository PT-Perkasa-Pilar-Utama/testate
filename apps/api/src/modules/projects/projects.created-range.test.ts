import { describe, expect, it } from "bun:test";

import { createAccounts } from "../../../test/accounts.ts";
import type { NewProject } from "./projects.repository.ts";

const BASE = { limit: 50, sort: "name", order: "asc", ids: null } as const;

function project(id: string, slug: string, createdBy: string, createdAt: string): NewProject {
  return {
    id,
    slug,
    name: slug,
    description: null,
    quota_bytes: null,
    created_by: createdBy,
    created_at: createdAt,
  };
}

describe("projects created-date range", () => {
  it("list() keeps a row inside the range and drops one outside it, and total() counts the same set", async () => {
    const { admin, projectsRepo } = await createAccounts();
    projectsRepo.insert(
      project("01991f00-0000-7000-8000-0000000000p1", "shop", admin.id, "2026-08-29T12:00:00.000Z")
    );
    projectsRepo.insert(
      project(
        "01991f00-0000-7000-8000-0000000000p2",
        "billing",
        admin.id,
        "2026-09-02T12:00:00.000Z"
      )
    );
    const inRange = { ...BASE, created_from: "2026-08-28", created_to: "2026-08-30" };
    expect(projectsRepo.list(inRange).map((row) => row.slug)).toStrictEqual(["shop"]);
    expect(projectsRepo.total(inRange)).toBe(1);
    const outOfRange = { ...BASE, created_from: "2026-09-03" };
    expect(projectsRepo.list(outOfRange)).toStrictEqual([]);
    expect(projectsRepo.total(outOfRange)).toBe(0);
  });
});
