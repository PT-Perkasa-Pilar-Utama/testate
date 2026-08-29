import { expect, test } from "@playwright/test";

import { demoAdapter, demoTables, swallow } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

async function tableNamed(adapterId: string, suffix: string): Promise<string> {
  const found = (await demoTables(adapterId)).find((name) => name.endsWith(suffix));
  if (found === undefined) throw new Error(`no table ends with ${suffix}`);
  return found;
}

test.describe("admin gap stories", () => {
  test.use({ storageState: statePath("admin") });

  test("@story-1 @story-2 a new user logs in with the temporary password and must choose a new one", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Username").fill(`fresh-${STAMP}`);
    await dialog.getByLabel("Display name").fill("Fresh");
    await dialog
      .getByLabel(/password/i)
      .first()
      .fill("fresh-temporary-1234");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("tr", { hasText: `fresh-${STAMP}` })).toBeVisible();
    // The admin session is dropped so the same page becomes the new user's browser.
    await page.context().clearCookies();
    await page.goto("/projects");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Sign in to Testate" })).toBeVisible();
    await page.getByLabel("Username").fill(`fresh-${STAMP}`);
    await page.getByLabel("Password").fill("fresh-temporary-1234");
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("Current password").fill("fresh-temporary-1234");
    await page.getByLabel("New password").fill("fresh-final-password-1");
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-13 @story-14 @story-16 sets a project quota, reads the deletion plan, and deletes by typing the slug", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects");
    await settle(page);
    await page.getByRole("button", { name: "New project" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill(`Gone ${STAMP}`);
    await page.locator("dialog[open]").getByLabel("Slug").fill(`gone-${STAMP}`);
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: `Gone ${STAMP}` }).click();
    await settle(page);
    await page.getByRole("button", { name: "Edit" }).click();
    await page
      .locator("dialog[open]")
      .getByLabel(/Snapshot quota in GiB/)
      .fill("1");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByText(/% used/)).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    const plan = page.locator("dialog[open]");
    await expect(plan.getByText(/protected state\(s\) will be deleted/)).toBeVisible();
    const confirm = plan.getByRole("button", { name: "Return to init and delete" });
    await expect(confirm).toBeDisabled();
    await plan.getByLabel("Type the slug to confirm").fill(`gone-${STAMP}`);
    await confirm.click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("link", { name: `Gone ${STAMP}` })).toHaveCount(0, {
      timeout: 30_000,
    });
    expect(issues).toStrictEqual([]);
  });

  test("@story-147 an admin locks a policy so that qa cannot remove it", async ({
    page,
    browser,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const path = `/projects/demo/adapters/${postgres.id}/policies`;
    await page.goto(path);
    await settle(page);
    const row = page.locator("tr", { hasText: "email" }).first();
    await row.getByRole("button", { name: "Add" }).click();
    await page.locator("dialog[open]").getByLabel("Mask").selectOption("redact");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("mask redact")).toBeVisible();
    await row.getByRole("button", { name: "Lock" }).click();
    await expect(row.getByText("locked")).toBeVisible();
    const qa = await browser.newContext({ storageState: statePath("qa") });
    const qaPage = await qa.newPage();
    await qaPage.goto(path);
    await settle(qaPage);
    const qaRow = qaPage.locator("tr", { hasText: "email" }).first();
    await expect(qaRow.getByText("locked")).toBeVisible();
    await expect(qaRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await qa.close();
    await row.getByRole("button", { name: "Unlock" }).click();
    await expect(row.getByText("locked")).toHaveCount(0);
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row.getByText("mask redact")).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });
});

test.describe("qa gap stories", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-36 the grid pages, sorts, and filters rows", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await tableNamed(postgres.id, "customers");
    await page.goto(`/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await page.getByLabel("Rows per page").selectOption("25");
    await settle(page);
    const rows = await page.locator("main tbody tr").count();
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(25);
    await expect(page.getByRole("button", { name: "First" })).toBeDisabled();
    const firstBefore = await page.locator("main tbody tr").first().innerText();
    await page.getByRole("button", { name: /^email/ }).click();
    await settle(page);
    await page.getByRole("button", { name: /^email/ }).click();
    await settle(page);
    const firstAfter = await page.locator("main tbody tr").first().innerText();
    expect(firstAfter).not.toBe(firstBefore);
    await page.getByLabel("Filter column").selectOption("email");
    await page.getByLabel("Filter operator").selectOption("like");
    await page.getByLabel("Filter value").fill("%@x.io");
    await page.getByRole("button", { name: "Add filter" }).click();
    await settle(page);
    await expect(page.locator("main tbody tr").first()).toContainText("@x.io");
    await expect(page.locator("main tbody tr")).toHaveCount(
      await page.locator("main tbody tr", { hasText: "@x.io" }).count()
    );
    expect(issues).toStrictEqual([]);
  });

  test("@story-46 @story-48 the query console keeps a history and cancels a running query", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    await page.goto(`/projects/demo/adapters/${postgres.id}/query`);
    await settle(page);
    await page.getByPlaceholder("SELECT ...").fill(`select 1 as h${STAMP}`);
    await page.getByRole("button", { name: "Run (read-only)" }).click();
    await expect(page.getByText(/1 row\(s\)/)).toBeVisible();
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.locator("main").getByText(`select 1 as h${STAMP}`)).toBeVisible();
    const slow = swallow(
      page.request.post(
        `http://localhost:3000/api/v1/projects/demo/adapters/${postgres.id}/query`,
        {
          headers: { "X-Testate-Request": "1" },
          data: { dialect: "sql", mode: "read", row_cap: 10, text: "select pg_sleep(20)" },
        }
      )
    );
    await page.getByRole("tab", { name: "Running" }).click();
    await expect(async () => {
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.getByRole("button", { name: "Cancel" }).first()).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(async () => {
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await slow;
    expect(issues).toStrictEqual([]);
  });

  test("@story-142 the insert form offers a lookup on a foreign key column", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await tableNamed(postgres.id, "orders");
    await page.goto(`/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await page.getByRole("switch", { name: "Write mode" }).click();
    await page.getByRole("button", { name: "Insert row" }).click();
    const field = page
      .locator("dialog[open] div", { has: page.locator("code", { hasText: /^customer_id$/ }) })
      .last()
      .locator("input")
      .last();
    await field.fill("z");
    // Clearing the text asks for the first candidates without a prefix, whatever the ids are.
    const lookup = page.waitForResponse((response) => /\/lookup\?.*q=(&|$)/.test(response.url()));
    await field.fill("");
    const answer = await lookup;
    const body = await answer.text();
    expect(answer.status(), body).toBe(200);
    expect(body, body).toMatch(/"key":\[/);
    await expect(page.locator("dialog[open] datalist option").first()).toBeAttached();
    await page.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("switch", { name: "Write mode" }).click();
    expect(issues).toStrictEqual([]);
  });
  test("@story-51 the import wizard reads a file straight from a storage adapter", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const storage = await demoAdapter({ kind: "storage" });
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await tableNamed(postgres.id, "customers");
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "Imports" }).click();
    await page.getByRole("button", { name: "New import" }).click();
    const wizard = page.locator("dialog[open]");
    await wizard.getByRole("tab", { name: "From a storage adapter" }).click();
    await wizard.getByLabel("Storage adapter").selectOption({ label: storage.name });
    await wizard.getByLabel("Path").fill("imports/customers.csv");
    await wizard.getByRole("button", { name: "Load file" }).click();
    await expect(wizard.getByRole("columnheader", { name: "email" })).toBeVisible({
      timeout: 60_000,
    });
    await wizard.getByLabel("Database adapter").selectOption({ label: postgres.name });
    await wizard.getByLabel("Table").selectOption(table);
    await wizard.getByLabel("Mapping name").fill(`storage-${STAMP}`);
    await wizard.getByRole("button", { name: "Dry run" }).click();
    await expect(wizard.getByText(/Dry run: .*skipped 2 · failed 0/)).toBeVisible({
      timeout: 90_000,
    });
    await page.keyboard.press("Escape");
    expect(issues).toStrictEqual([]);
  });
});
