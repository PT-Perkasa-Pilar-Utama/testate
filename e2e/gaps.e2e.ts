import { expect, test } from "@playwright/test";

import { demoAdapter, demoTables, swallow } from "./lib/api.ts";
import { dataRows, settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

async function tableNamed(adapterId: string, suffix: string): Promise<string> {
  const found = (await demoTables(adapterId)).find((name) => name.endsWith(suffix));
  if (found === undefined) throw new Error(`no table ends with ${suffix}`);
  return found;
}

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
    const rows = await dataRows(page).count();
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(25);
    await expect(page.getByRole("button", { name: "First" })).toBeDisabled();
    await page.getByLabel("Filter column").selectOption("email");
    await page.getByLabel("Filter value").fill(`nobody-${STAMP}@x.io`);
    await page.getByRole("button", { name: "Add filter" }).click();
    await settle(page);
    await expect(page.getByText("No rows match. Clear a filter to see more.")).toBeVisible();
    await expect(dataRows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Remove filter" }).click();
    await settle(page);
    const firstBefore = await dataRows(page).first().innerText();
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
  test("@story-140 the grid lists foreign keys and an FK cell links to the referenced row", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const orders = await tableNamed(postgres.id, "orders");
    await page.goto(`/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(orders)}`);
    await settle(page);
    await expect(page.getByText(/customer_id → .*customers\.id/)).toBeVisible();
    const link = page.locator("main tbody a").first();
    const value = await link.innerText();
    await link.click();
    await settle(page);
    await expect(page).toHaveURL(/customers.*filter=id%3Aeq%3A/);
    await expect(page.getByText(`id eq ${value}`)).toBeVisible();
    // The chip says what was asked for; the row has to be the answer, and an empty table is a row.
    await expect(dataRows(page)).toHaveCount(1);
    await expect(dataRows(page).first()).toContainText(value);
    await expect(page.getByText(/← .*orders\.customer_id/)).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});
