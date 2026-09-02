import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { demoAdapter, demoTables, swallow } from "./lib/api.ts";
import { dataRows, settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";
import { API_PORT } from "../playwright.config.ts";

const STAMP = Date.now().toString(36);

async function tableNamed(adapterId: string, suffix: string): Promise<string> {
  const found = (await demoTables(adapterId)).find((name) => name.endsWith(suffix));
  if (found === undefined) throw new Error(`no table ends with ${suffix}`);
  return found;
}

/**
 * A qa write session on an adapter is one at a time (`data.sessions.ts`, keyed by adapter + user)
 * with a 30-minute idle timeout, so a session another spec leaves open by dying mid-write-mode
 * blocks every later `start()` for the rest of the run with a 409, and the switch in the toolbar
 * never turns the "Insert row" button on. Opening (then closing) our own session first clears a
 * stale one before this test needs the real thing.
 */
async function clearWriteSession(page: Page, slug: string, adapterId: string): Promise<void> {
  const base = `http://localhost:${API_PORT}/api/v1/projects/${slug}/adapters/${adapterId}/write-sessions`;
  const headers = { "X-Testate-Request": "1" };
  const opened = await page.request.post(base, { headers, data: { foreign_key_checks: true } });
  if (opened.status() === 201) {
    const body: { data: { id: string } } = await opened.json();
    await page.request.delete(`${base}/${body.data.id}`, { headers });
    return;
  }
  if (opened.status() === 409) {
    const body: { error: { details?: { write_session_id?: string } } } = await opened.json();
    const stale = body.error.details?.write_session_id;
    if (stale !== undefined) await page.request.delete(`${base}/${stale}`, { headers });
  }
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
    await expect(
      page.getByText("No rows match your filters. Remove one above to see more.")
    ).toBeVisible();
    await expect(dataRows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Remove filter" }).click();
    await settle(page);
    // Sort by id, both ways, and judge each against the ids on the page rather than against the
    // previous first row: a parallel spec can leave the table with one row, and then "the first
    // row changed" is false however well sorting works.
    const ids = (await dataRows(page).locator("td:first-child").allInnerTexts()).map(Number);
    await page.getByRole("button", { name: /^id/ }).click();
    await settle(page);
    const firstAscending = Number(
      await dataRows(page).locator("td:first-child").first().innerText()
    );
    expect(firstAscending).toBeLessThanOrEqual(Math.min(...ids));
    await page.getByRole("button", { name: /^id/ }).click();
    await settle(page);
    const firstDescending = Number(
      await dataRows(page).locator("td:first-child").first().innerText()
    );
    expect(firstDescending).toBeGreaterThanOrEqual(Math.max(...ids));
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
    // The console's own side panel, not a project tab: Saved, History and Running sit beside the
    // editor since the rework.
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.locator("main").getByText(`select 1 as h${STAMP}`)).toBeVisible();
    const slow = swallow(
      page.request.post(
        `http://localhost:${API_PORT}/api/v1/projects/demo/adapters/${postgres.id}/query`,
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
    await clearWriteSession(page, "demo", postgres.id);
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
  test("@story-51 an import reads its file straight from a file store", async ({ page }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const storage = await demoAdapter({ kind: "storage" });
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await tableNamed(postgres.id, "customers");
    // Importing belongs to the database it writes into, so the screen hangs off that adapter now
    // and no longer opens as a wizard over the project.
    await page.goto(`/projects/demo/adapters/${postgres.id}/imports`);
    await settle(page);
    await page.getByText("Or take one from a file store").click();
    await page.getByLabel("File store").selectOption({ label: storage.name });
    await page.getByLabel("Path").fill("imports/customers.csv");
    await page.getByRole("button", { name: "Load" }).click();
    // The story is the source, not the write: the file store answered and the file parsed into
    // columns a normalizer can be built on. What an import then does to a table is story 50's.
    await expect(page.getByRole("columnheader", { name: "email" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("The first rows of the file.")).toBeVisible();
    // Anchored, not exact: the select is inside its label, so its accessible name is the label
    // plus every option under it ("Tablechoose a table..."). A bare "Table" also matches the
    // "What happens" select, whose options talk about adding rows to the table.
    await page.getByLabel(/^Table/).selectOption(table);
    // Import itself stays shut until the check answers; the file store's part is done when the
    // screen can run that check.
    await expect(page.getByRole("button", { name: "Check the file" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
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
