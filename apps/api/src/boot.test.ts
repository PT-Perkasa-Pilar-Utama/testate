import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ADMIN_PASSWORD, TEST_META, createAccounts } from "../test/accounts.ts";
import { preMigrationCopies } from "../test/boot-copies.ts";
import { preMigrationCopy, resetAdminPassword } from "./boot.ts";
import { loadConfig } from "./lib/config/index.ts";
import type { Config } from "./lib/config/index.ts";

const RECOVERED = "recovered-admin-password-1";

/** The environment a recovery boot runs with; the rest of the config takes its defaults. */
function configWith(overrides: Record<string, string>): Config {
  return loadConfig({
    TESTATE_SECRETS_ACTIVE_KEY: "a".repeat(44),
    TESTATE_ADMIN_PASSWORD_RESET: "true",
    ...overrides,
  });
}

describe("boot", () => {
  it("copies the metadata database before migrations and keeps the last three", () => {
    const dir = mkdtempSync(join(tmpdir(), "testate-boot-"));
    mkdirSync(join(dir, "run"), { recursive: true });
    expect(preMigrationCopy(dir, "01a0-first")).toBeNull();

    writeFileSync(join(dir, "metadata.db"), "one");
    expect(preMigrationCopy(dir, "01a0-a")).not.toBeNull();
    writeFileSync(join(dir, "metadata.db"), "two");
    for (const id of ["01a0-b", "01a0-c", "01a0-d"]) preMigrationCopy(dir, id);

    const copies = preMigrationCopies(dir);
    expect(copies).toStrictEqual([
      "metadata-01a0-b.db",
      "metadata-01a0-c.db",
      "metadata-01a0-d.db",
    ]);
    expect(readFileSync(join(dir, "run", "metadata-01a0-b.db"), "utf8")).toBe("two");
  });

  it("resets the admin password from the environment and ends its sessions", async () => {
    const h = await createAccounts();
    const before = await h.auth.login({ username: "admin", password: ADMIN_PASSWORD }, TEST_META);
    const config = configWith({ TESTATE_ADMIN_PASSWORD: RECOVERED });

    expect(await resetAdminPassword(h.users, config)).toBe(true);
    // The old password and the session it opened are both gone.
    await expect(
      h.auth.login({ username: "admin", password: ADMIN_PASSWORD }, TEST_META)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.db.query("SELECT id FROM sessions").all().length).toBe(0);
    expect(before.sessionToken.length).toBeGreaterThan(0);

    const after = await h.auth.login({ username: "admin", password: RECOVERED }, TEST_META);
    expect(after.response.must_change_password).toBe(true);
  });

  it("does nothing without the flag, and refuses a boot that names no admin", async () => {
    const h = await createAccounts();
    const idle = loadConfig({
      TESTATE_SECRETS_ACTIVE_KEY: "a".repeat(44),
      TESTATE_ADMIN_PASSWORD: RECOVERED,
    });
    expect(await resetAdminPassword(h.users, idle)).toBe(false);

    // A flag with no password, a name nobody has, and a name that is not an admin all refuse.
    await expect(resetAdminPassword(h.users, configWith({}))).rejects.toMatchObject({
      name: "ConfigError",
    });
    await expect(
      resetAdminPassword(
        h.users,
        configWith({ TESTATE_ADMIN_PASSWORD: RECOVERED, TESTATE_ADMIN_USER: "nobody" })
      )
    ).rejects.toMatchObject({ name: "ConfigError" });

    await h.users.create(
      h.admin,
      {
        username: "dina.qa",
        display_name: "Dina",
        role: "qa",
        temporary_password: "temporary-password-1",
      },
      TEST_META
    );
    await expect(
      resetAdminPassword(
        h.users,
        configWith({ TESTATE_ADMIN_PASSWORD: RECOVERED, TESTATE_ADMIN_USER: "dina.qa" })
      )
    ).rejects.toMatchObject({ name: "ConfigError" });
    // The refusal left that account alone.
    await expect(
      h.auth.login({ username: "dina.qa", password: "temporary-password-1" }, TEST_META)
    ).resolves.toBeDefined();
  });
});
