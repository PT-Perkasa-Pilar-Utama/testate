import { describe, expect, it } from "bun:test";

import { TEST_META, createAccounts } from "../../../test/accounts.ts";
import type { AccountsHarness } from "../../../test/accounts.ts";
import { createAuthRepository } from "./auth.repository.ts";

// #55, Q5 (docs/decisions/2026-10-09-project-scope.md): deleting a project takes only that project
// out of each token's scope. A token is revoked only when nothing is left.
const SHOP = "01991f00-0000-7000-8000-000000000021";
const CRM = "01991f00-0000-7000-8000-000000000022";

async function withTokens(harness: AccountsHarness) {
  for (const [id, slug] of [
    [SHOP, "shop"],
    [CRM, "crm"],
  ] as const) {
    harness.projectsRepo.insert({
      id,
      slug,
      name: slug,
      description: null,
      quota_bytes: null,
      created_by: harness.admin.id,
      created_at: harness.now().toISOString(),
    });
  }
  const make = async (name: string, projectIds: string[] | null) =>
    (
      await harness.auth.createToken(
        harness.admin,
        { name, kind: "standard", role: "qa", project_ids: projectIds },
        TEST_META
      )
    ).record.id;
  return {
    onlyShop: await make("only-shop", [SHOP]),
    both: await make("both", [SHOP, CRM]),
    everything: await make("everything", null),
    onlyCrm: await make("only-crm", [CRM]),
  };
}

describe("deleting a project and the tokens that reach it", () => {
  it("revokes a token left with no project and narrows one that reaches others", async () => {
    const harness = await createAccounts();
    const ids = await withTokens(harness);
    const repo = createAuthRepository(harness.db);
    const counts = repo.dropProject(SHOP, harness.now().toISOString());
    const token = (id: string) => repo.tokenById(id);
    expect(counts).toStrictEqual({ revoked: 1, narrowed: 1 });
    expect(token(ids.onlyShop)?.revoked_at).not.toBeNull();
    expect(token(ids.onlyShop)?.project_ids).toStrictEqual([]);
    expect(token(ids.both)?.revoked_at).toBeNull();
    expect(token(ids.both)?.project_ids).toStrictEqual([CRM]);
    expect(token(ids.everything)?.project_ids).toBeNull();
    expect(token(ids.onlyCrm)?.project_ids).toStrictEqual([CRM]);
  });

  it("the deletion plan counts only the tokens the delete revokes", async () => {
    const harness = await createAccounts();
    await withTokens(harness);
    expect(harness.projectsRepo.deletionCounts(SHOP).tokens).toBe(1);
    expect(harness.projectsRepo.deletionCounts(CRM).tokens).toBe(1);
  });
});
