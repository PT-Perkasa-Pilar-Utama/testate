import { describe, expect, it } from "bun:test";

const NEWEST_FIRST = { sort: "created_at", order: "desc" } as const;

import { TEST_META, actorOf, createAccounts } from "../../../test/accounts.ts";

const HOUR = 60 * 60 * 1000;
const PROJECT = "01991f00-0000-7000-8000-000000000010";

describe("api tokens", () => {
  it("creates a standard token that resolves to its role and scope", async () => {
    const { auth, admin, projectsRepo, now } = await createAccounts();
    projectsRepo.insert({
      id: PROJECT,
      slug: "shop",
      name: "Shop",
      description: null,
      quota_bytes: null,
      created_by: admin.id,
      created_at: now().toISOString(),
    });
    const { token, record } = await auth.createToken(
      admin,
      { name: "ci-shop", kind: "standard", role: "qa", project_ids: [PROJECT] },
      TEST_META
    );
    expect(token.startsWith("tst_")).toBe(true);
    expect(record.prefix).toBe(token.slice(4, 12));
    const resolved = await auth.fromBearer(token);
    expect(resolved?.actor).toMatchObject({
      kind: "token",
      role: "qa",
      agent: false,
      label: "token:ci-shop",
    });
    expect(resolved?.projectScope).toStrictEqual([PROJECT]);
  });

  it("makes agent tokens viewer-only with a 90-day default expiry and a 365-day cap", async () => {
    const { auth, admin, advance } = await createAccounts();
    const { token, record } = await auth.createToken(
      admin,
      { name: "claude", kind: "agent", project_ids: null },
      TEST_META
    );
    expect(record.role).toBe("viewer");
    expect(record.expires_at).toBe("2026-11-26T08:00:00.000Z");
    expect((await auth.fromBearer(token))?.actor.agent).toBe(true);
    await expect(
      auth.createToken(
        admin,
        { name: "long", kind: "agent", project_ids: null, expires_at: "2028-01-01T00:00:00.000Z" },
        TEST_META
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    advance(91 * 24 * HOUR);
    expect(await auth.fromBearer(token)).toBeNull();
  });

  it("refuses revoked and unknown tokens", async () => {
    const { auth, admin } = await createAccounts();
    const { token, record } = await auth.createToken(
      admin,
      { name: "ci", kind: "standard", role: "viewer", project_ids: null },
      TEST_META
    );
    await auth.revokeToken(admin, record.id, TEST_META);
    expect(await auth.fromBearer(token)).toBeNull();
    expect(await auth.fromBearer("tst_nope")).toBeNull();
    expect(await auth.fromBearer("Bearer-less")).toBeNull();
    await expect(
      auth.revokeToken(admin, "01991f00-0000-7000-8000-0000000000ff", TEST_META)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists tokens by kind and revocation state without the secret", async () => {
    const { auth, admin } = await createAccounts();
    const standard = await auth.createToken(
      admin,
      { name: "ci", kind: "standard", role: "qa", project_ids: null },
      TEST_META
    );
    await auth.createToken(admin, { name: "agent", kind: "agent", project_ids: null }, TEST_META);
    await auth.revokeToken(admin, standard.record.id, TEST_META);
    expect(
      (await auth.listTokens({ ...NEWEST_FIRST, kind: "agent" })).map((t) => t.name)
    ).toStrictEqual(["agent"]);
    expect(
      (await auth.listTokens({ ...NEWEST_FIRST, revoked: true })).map((t) => t.name)
    ).toStrictEqual(["ci"]);
    expect((await auth.listTokens(NEWEST_FIRST)).length).toBe(2);
  });

  it("survives deleting the admin who created the token", async () => {
    const { auth, users, admin } = await createAccounts();
    const { token } = await auth.createToken(
      admin,
      { name: "ci", kind: "standard", role: "qa", project_ids: null },
      TEST_META
    );
    const second = await users.create(
      admin,
      {
        username: "second.admin",
        display_name: "Second",
        role: "admin",
        temporary_password: "temporary-password-1",
      },
      TEST_META
    );
    await users.remove(actorOf(second), admin.id, TEST_META);
    expect((await auth.fromBearer(token))?.actor.role).toBe("qa");
    expect((await auth.listTokens(NEWEST_FIRST))[0]?.created_by).toBeNull();
  });

  it("writes token audit rows", async () => {
    const { auth, audit, admin } = await createAccounts();
    const { record } = await auth.createToken(
      admin,
      { name: "ci", kind: "standard", role: "qa", project_ids: null },
      TEST_META
    );
    await auth.revokeToken(admin, record.id, TEST_META);
    const actions = (await audit.list({ limit: 10, action: "token." })).rows.map(
      (row) => row.action
    );
    expect(actions).toStrictEqual(["token.revoked", "token.created"]);
  });

  it("refuses project ids that do not exist", async () => {
    const { auth, admin } = await createAccounts();
    await expect(
      auth.createToken(
        admin,
        { name: "ci", kind: "standard", role: "qa", project_ids: [PROJECT] },
        TEST_META
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a token past its per-minute budget with RATE_LIMITED and a wait", async () => {
    const { auth, admin } = await createAccounts({ tokenBudget: async () => 2 });
    const { token } = await auth.createToken(
      admin,
      { name: "busy", kind: "standard", role: "viewer", project_ids: [] },
      TEST_META
    );
    await auth.fromBearer(token);
    await auth.fromBearer(token);
    await expect(auth.fromBearer(token)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });
  });
});
