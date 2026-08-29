import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

async function postgresBase(): Promise<string> {
  return `/projects/demo/adapters/${(await demoAdapter({ engine: "postgres" })).id}`;
}

async function fieldInput(page: Page, column: string): Promise<ReturnType<Page["locator"]>> {
  return page
    .locator("dialog[open] div", { has: page.locator("code", { hasText: column }) })
    .last()
    .locator("input")
    .last();
}

test.describe("qa flows", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-37 @story-38 @story-45 @story-47 query console runs SQL, saves the query, reloads it, and deletes it", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto(`${await postgresBase()}/query`);
    await settle(page);
    await page.getByLabel("SQL").fill("SELECT 42 AS answer");
    await page.getByRole("button", { name: "Run (read-only)" }).click();
    await expect(page.getByText("1 row(s)")).toBeVisible();
    await expect(page.getByText("read-only transaction")).toBeVisible();
    await page.getByPlaceholder("save as...").fill("e2e answer");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "e2e answer" })).toBeVisible();
    await page.getByLabel("SQL").fill("");
    await page.getByRole("button", { name: "e2e answer" }).click();
    await expect(page.getByLabel("SQL")).toHaveValue("SELECT 42 AS answer");
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByRole("button", { name: "e2e answer" })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-40 @story-41 @story-42 @story-141 @story-144 @story-145 a write session inserts, edits, and deletes a row in the grid", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const base = `/projects/demo/adapters/${postgres.id}`;
    const table = await firstTable(postgres.id);
    await page.goto(`${base}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await page.getByRole("switch", { name: "Write mode" }).click();
    await expect(page.getByRole("button", { name: "Insert row" })).toBeVisible();
    await page.getByRole("button", { name: "Insert row" }).click();
    await (await fieldInput(page, "email")).fill("e2e@x.io");
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByText("e2e@x.io")).toBeVisible();
    const row = page.locator("tr", { hasText: "e2e@x.io" });
    await row.getByRole("button", { name: "Edit" }).click();
    await (await fieldInput(page, "email")).fill("e2e-edited@x.io");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("e2e-edited@x.io")).toBeVisible();
    await page
      .locator("tr", { hasText: "e2e-edited@x.io" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText("e2e-edited@x.io")).toHaveCount(0);
    await page.getByRole("switch", { name: "Write mode" }).click();
    await expect(page.getByRole("button", { name: "Insert row" })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-146 a column policy is added, shown in the form, and removed", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto(`${await postgresBase()}/policies`);
    await settle(page);
    const row = page.locator("tr", { hasText: "email" }).first();
    await row.getByRole("button", { name: "Add" }).click();
    await page.locator("dialog[open]").getByLabel("Mask").selectOption("redact");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("mask redact")).toBeVisible();
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row.getByText("mask redact")).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-98 @story-99 @story-100 a REST request is saved, run against MinIO, and deleted", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const rest = await demoAdapter({ kind: "rest" });
    await page.goto(`/projects/demo/adapters/${rest.id}/requests`);
    await settle(page);
    await page.getByRole("button", { name: "New request" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill("e2e ping");
    await page.locator("dialog[open]").getByLabel("Expected status (blank for any)").fill("200");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const row = page.locator("tr", { hasText: "e2e ping" });
    await row.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("Recent runs")).toBeVisible();
    await expect(
      page
        .locator("aside")
        .getByText(/^\d{3}$/)
        .first()
    ).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-93 @story-94 @story-95 the storage browser opens a folder and previews a file", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const storage = await demoAdapter({ kind: "storage" });
    await page.goto(`/projects/demo/adapters/${storage.id}/files`);
    await settle(page);
    const folder = page.locator("main a", { hasText: /\/$/ }).first();
    await folder.click();
    await settle(page);
    const file = page.locator("main tbody button").first();
    await file.click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.locator("dialog[open]").getByText("Close", { exact: true }).click();
    expect(issues).toStrictEqual([]);
  });
});

test.describe("admin flows", () => {
  test.use({ storageState: statePath("admin") });

  test("@story-3 @story-111 creates a user and a token from the admin screens", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Username").fill("e2e.user");
    await dialog.getByLabel("Display name").fill("E2E User");
    await dialog
      .getByLabel(/password/i)
      .first()
      .fill("e2e-temporary-1234");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("e2e.user")).toBeVisible();
    await page.goto("/tokens");
    await settle(page);
    await page.getByRole("button", { name: "New token" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill("e2e token");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(/tst_/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("e2e token")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});
