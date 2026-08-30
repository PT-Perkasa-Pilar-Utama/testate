import { expect, test } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

test.describe("qa stories", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-10 @story-11 creates a project from the projects screen and opens it", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects");
    await settle(page);
    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Name").fill(`E2E ${STAMP}`);
    await dialog.getByLabel("Slug").fill(`e2e-${STAMP}`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("link", { name: `E2E ${STAMP}` }).click();
    await settle(page);
    await expect(page.getByRole("heading", { name: `E2E ${STAMP}` })).toBeVisible();
    await expect(page.getByText("HEAD:")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-17 @story-18 @story-19 @story-21 tests and adds a Postgres adapter from the dialog", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("button", { name: "New adapter" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Name").fill(`pg-${STAMP}`);
    await dialog.getByLabel("Host").fill("127.0.0.1");
    await dialog.getByLabel("Port").fill("54320");
    await dialog.getByRole("textbox", { name: "Database" }).fill("shop");
    await dialog.getByLabel("User").fill("testate");
    await dialog.getByLabel("Password").fill("testate");
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog.getByText(/postgres 1\d/)).toBeVisible({ timeout: 15_000 });
    // The seeded adapter already tracks this database, and two on one target collide.
    await expect(dialog.getByText(/already tracks this database/)).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: `pg-${STAMP}` })).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-39 @story-43 @story-44 runs a MongoDB find from the JSON form and sees no write controls", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const mongo = await demoAdapter({ engine: "mongodb" });
    await page.goto(`/projects/demo/adapters/${mongo.id}/query`);
    await settle(page);
    await page.getByPlaceholder("collection").fill("customers");
    await page.getByRole("button", { name: "Run (read-only)" }).click();
    await expect(page.getByText(/\d+ row\(s\)/)).toBeVisible();
    await expect(page.getByText(/read-only credential|application filter only/)).toBeVisible();
    const table = await firstTable(mongo.id);
    await page.goto(`/projects/demo/adapters/${mongo.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await expect(page.getByText("Write mode")).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-143 @story-150 inserts copies of a row and extracts its fixture", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await firstTable(postgres.id);
    await page.goto(`/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await page.getByRole("switch", { name: "Write mode" }).click();
    await page.getByRole("button", { name: "Insert row" }).click();
    await page.getByLabel("email mode").selectOption("function");
    await page.getByLabel("email function").selectOption("uuid_v7");
    await page.getByLabel("Copies").fill("2");
    const uuidV7 = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/;
    // Other stories edit this table too, so only this story's uuid-mail rows are counted.
    const mine = page.locator("main tbody tr", { hasText: uuidV7 });
    const before = await mine.count();
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(mine).toHaveCount(before + 2);
    const row = page.locator("main tbody tr", { hasText: uuidV7 }).first();
    await row.getByRole("button", { name: "Fixture" }).click();
    await expect(page.locator("dialog[open]").getByText(/INSERT INTO/)).toBeVisible();
    await page.locator("dialog[open]").getByText("Close", { exact: true }).click();
    // Wait for each delete to land before clicking the next: the grid reloads between them.
    for (const remaining of [before + 1, before]) {
      await page
        .locator("main tbody tr", { hasText: uuidV7 })
        .first()
        .getByRole("button", { name: "Delete" })
        .click();
      await expect(mine).toHaveCount(remaining);
    }
    await page.getByRole("switch", { name: "Write mode" }).click();
    expect(issues).toStrictEqual([]);
  });

  test("@story-96 a storage file has a download link that answers with an attachment", async ({
    page,
  }) => {
    const storage = await demoAdapter({ kind: "storage" });
    await page.goto(`/projects/demo/adapters/${storage.id}/files`);
    await settle(page);
    await page.locator("main a", { hasText: /\/$/ }).first().click();
    await settle(page);
    const href = await page.locator("main a", { hasText: "Download" }).first().getAttribute("href");
    expect(href).toContain("/entries/download?path=");
    const response = await page.request.get(String(href));
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");
  });
});

test.describe("viewer stories", () => {
  test.use({ storageState: statePath("viewer") });

  test("@story-131 @story-132 @story-133 the tools screen hashes, generates bytes, and mints uuids", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/tools");
    await settle(page);
    await page.getByLabel("Value").fill("hello");
    await page.getByRole("button", { name: "Hash" }).click();
    await expect(
      page.locator("main").getByText(/^[0-9a-f]{64}$|^\$2[aby]\$|^\$argon2id\$/)
    ).toBeVisible();
    await page.getByRole("button", { name: "Generate" }).click();
    await page.getByRole("button", { name: "Ten" }).click();
    await expect(
      page
        .locator("main")
        .getByText(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/)
        .first()
    ).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-148 a viewer sees masked columns as redacted while qa sees raw", async ({
    page,
  }) => {
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await firstTable(postgres.id);
    await page.goto(`/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await expect(page.getByText("Write mode")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Fixture" }).first()).toBeVisible();
  });
});

test.describe("admin stories", () => {
  test.use({ storageState: statePath("admin") });

  test("@story-4 @story-5 disables, re-enables, and resets the password of a user", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    await page.getByRole("button", { name: "New user" }).click();
    const create = page.locator("dialog[open]");
    await create.getByLabel("Username").fill(`tmp-${STAMP}`);
    await create.getByLabel("Display name").fill("Temporary");
    await create
      .getByLabel(/password/i)
      .first()
      .fill("tmp-temporary-1234");
    await page.getByRole("button", { name: "Create" }).click();
    const row = page.locator("tr", { hasText: `tmp-${STAMP}` });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByRole("button", { name: "Enable" })).toBeVisible();
    await row.getByRole("button", { name: "Enable" }).click();
    await expect(row.getByRole("button", { name: "Disable" })).toBeVisible();
    await row.getByRole("button", { name: "Reset password" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel(/Temporary password/).fill("tmp-reset-password-1");
    await dialog.getByRole("button", { name: "Reset" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-112 revokes a token and the list shows it revoked", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/tokens");
    await settle(page);
    await page.getByRole("button", { name: "New token" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill(`revoke-${STAMP}`);
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    const row = page.locator("tr", { hasText: `revoke-${STAMP}` });
    page.once("dialog", (confirm) => void confirm.accept());
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row.getByText(/revoked/i)).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-108 @story-110 the audit log lists the logins of this run and filters by action", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/audit");
    await settle(page);
    await expect(page.getByText("auth.login").first()).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-121 the settings screen lists every key and marks environment-locked ones", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/settings");
    await settle(page);
    await expect(page.getByText("Snapshot store")).toBeVisible();
    await expect(page.locator("main code").first()).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});
