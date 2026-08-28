import { describe, expect, it } from "bun:test";
import { userSchema } from "@testate/shared";

import { TEST_META, actorOf, createAccounts } from "../../../test/accounts.ts";
import { expectContract } from "../../../test/contract.ts";
import { USER_MOCK } from "./users.mock.ts";

const QA = {
  username: "dina.qa",
  display_name: "Dina Putri",
  role: "qa",
  temporary_password: "temporary-password-1",
} as const;
const BASE = { limit: 10, sort: "username", order: "asc" } as const;

describe("users", () => {
  it("mock matches the contract", () => {
    expectContract(userSchema, USER_MOCK, (clone) => {
      clone["username"] = "Has Spaces";
    });
  });

  it("bootstraps one admin that must change its password, and only once", async () => {
    const { users } = await createAccounts();
    const [admin] = await users.list(BASE);
    expect(admin?.role).toBe("admin");
    expect(admin?.must_change_password).toBe(true);
    expect(await users.bootstrap("admin", "another-password-123")).toBe(false);
  });

  it("creates a user with a temporary password and refuses a duplicate username case-insensitively", async () => {
    const { users, admin } = await createAccounts();
    const created = await users.create(admin, QA, TEST_META);
    expect(created.must_change_password).toBe(true);
    expect(created.role).toBe("qa");
    await expect(
      users.create(admin, { ...QA, username: "dina.qa" }, TEST_META)
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { username: "dina.qa" },
    });
    expect((await users.list(BASE)).length).toBe(2);
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    const { users } = await createAccounts();
    await expect(users.get("01991f00-0000-7000-8000-0000000000ff")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses to demote, disable, or delete the last enabled admin", async () => {
    const { users, admin } = await createAccounts();
    await expect(users.update(admin, admin.id, { role: "qa" }, TEST_META)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(users.setDisabled(admin, admin.id, true, TEST_META)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const second = await users.create(
      admin,
      { ...QA, username: "second.admin", role: "admin" },
      TEST_META
    );
    await expect(users.remove(actorOf(second), admin.id, TEST_META)).resolves.toBeUndefined();
  });

  it("refuses deleting the caller's own account", async () => {
    const { users, admin } = await createAccounts();
    await users.create(admin, { ...QA, username: "second.admin", role: "admin" }, TEST_META);
    await expect(users.remove(admin, admin.id, TEST_META)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("demotes an admin once another enabled admin exists", async () => {
    const { users, admin } = await createAccounts();
    await users.create(admin, { ...QA, username: "second.admin", role: "admin" }, TEST_META);
    const updated = await users.update(
      admin,
      admin.id,
      { role: "qa", display_name: "Ada" },
      TEST_META
    );
    expect(updated.role).toBe("qa");
    expect(updated.display_name).toBe("Ada");
  });

  it("disabling revokes sessions and blocks login; enabling restores it", async () => {
    const { users, auth, admin } = await createAccounts();
    const user = await users.create(admin, QA, TEST_META);
    const credentials = { username: QA.username, password: QA.temporary_password };
    const { sessionToken } = await auth.login(credentials, TEST_META);
    const disabled = await users.setDisabled(admin, user.id, true, TEST_META);
    expect(disabled.disabled_at).not.toBeNull();
    expect(await auth.fromSession(sessionToken)).toBeNull();
    await expect(auth.login(credentials, TEST_META)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const enabled = await users.setDisabled(admin, user.id, false, TEST_META);
    expect(enabled.disabled_at).toBeNull();
    await expect(auth.login(credentials, TEST_META)).resolves.toBeDefined();
  });

  it("reset-password sets a temporary password, clears the lockout, and revokes sessions", async () => {
    const { users, auth, admin } = await createAccounts();
    const user = await users.create(admin, QA, TEST_META);
    const credentials = { username: QA.username, password: QA.temporary_password };
    const { sessionToken } = await auth.login(credentials, TEST_META);
    await auth.changePassword(
      actorOf(user),
      QA.temporary_password,
      "a-new-password-123",
      sessionToken,
      TEST_META
    );
    await users.resetPassword(admin, user.id, "reset-password-456", TEST_META);
    expect(await auth.fromSession(sessionToken)).toBeNull();
    const login = await auth.login(
      { username: QA.username, password: "reset-password-456" },
      TEST_META
    );
    expect(login.response.must_change_password).toBe(true);
  });

  it("deletes a user and its sessions", async () => {
    const { users, auth, admin } = await createAccounts();
    const user = await users.create(admin, QA, TEST_META);
    const { sessionToken } = await auth.login(
      { username: QA.username, password: QA.temporary_password },
      TEST_META
    );
    await users.remove(admin, user.id, TEST_META);
    expect(await auth.fromSession(sessionToken)).toBeNull();
    await expect(users.get(user.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists with role, disabled, search, and sort filters", async () => {
    const { users, admin } = await createAccounts();
    const qa = await users.create(admin, QA, TEST_META);
    await users.create(
      admin,
      { ...QA, username: "vic.viewer", display_name: "Vic", role: "viewer" },
      TEST_META
    );
    await users.setDisabled(admin, qa.id, true, TEST_META);
    const names = async (query: Parameters<typeof users.list>[0]): Promise<string[]> =>
      (await users.list(query)).map((user) => user.username);
    expect(await names({ ...BASE, role: "viewer" })).toStrictEqual(["vic.viewer"]);
    expect(await names({ ...BASE, disabled: true })).toStrictEqual(["dina.qa"]);
    expect(await names({ ...BASE, q: "putri" })).toStrictEqual(["dina.qa"]);
    expect(await names({ ...BASE, order: "desc" })).toStrictEqual([
      "vic.viewer",
      "dina.qa",
      "admin",
    ]);
  });

  it("writes an audit row for every change", async () => {
    const { users, audit, admin } = await createAccounts();
    const user = await users.create(admin, QA, TEST_META);
    await users.resetPassword(admin, user.id, "reset-password-456", TEST_META);
    const actions = (await audit.list({ limit: 20, action: "user." })).rows.map(
      (row) => row.action
    );
    expect(actions).toStrictEqual(["user.password_reset", "user.created", "user.created"]);
  });
});
