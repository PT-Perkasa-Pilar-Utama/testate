import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { rowMenu, settle, stateRow, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

/**
 * A ready state prints no status badge, so "ready" is not a string to wait for. What a tester
 * actually waits for is the moment the state can be checked out, and that is the assertion.
 */
async function ready(row: Locator): Promise<void> {
  await expect(row.getByRole("button", { name: "Check out" })).toBeEnabled({ timeout: 60_000 });
}

// State jobs share the demo adapters; the two qa stories must not race each other.
test.describe.configure({ mode: "serial" });

test.describe("state stories", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-61 @story-62 @story-64 @story-65 @story-66 @story-67 @story-68 @story-69 @story-71 takes, edits, protects, downloads, and deletes a state", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const name = `e2e-state-${STAMP}`;
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "States" }).click();
    await page.getByRole("button", { name: "Take state" }).click();
    const take = page.locator("dialog[open]");
    await take.getByLabel("Name").fill(name);
    await take.getByLabel("Tags (comma separated)").fill("e2e, smoke");
    await take.getByRole("button", { name: "Take" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const row = stateRow(page, name);
    await ready(row);
    await expect(row.getByText("smoke")).toBeVisible();
    await page.getByRole("button", { name: "Take state" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill(name);
    await page.locator("dialog[open]").getByRole("button", { name: "Take" }).click();
    await expect(page.locator("dialog[open]").getByText(/exists|taken|conflict/i)).toBeVisible();
    await page.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
    await (await rowMenu(row)).getByRole("button", { name: "Edit" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill(`${name}-renamed`);
    await page.locator("dialog[open]").getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const renamed = stateRow(page, `${name}-renamed`);
    await expect(renamed).toBeVisible();
    await (await rowMenu(renamed)).getByRole("button", { name: "Protect" }).click();
    await expect(renamed.getByText("protected")).toBeVisible();
    await expect((await rowMenu(renamed)).getByRole("button", { name: "Delete" })).toBeDisabled();
    await renamed.getByRole("button", { name: "Unprotect" }).click();
    await expect((await rowMenu(renamed)).getByRole("button", { name: "Delete" })).toBeEnabled();
    const href = await renamed.getByRole("link", { name: "Download" }).getAttribute("href");
    const archive = await page.request.get(String(href));
    expect(archive.status()).toBe(200);
    expect(archive.headers()["content-disposition"]).toContain("attachment");
    await page.getByRole("tab", { name: "Tree" }).click();
    // The tree nests <li> inside <li>, so every ancestor of the node matches a hasText filter.
    // The name itself appears once.
    await expect(
      page
        .getByRole("list", { name: "State history" })
        .getByText(`${name}-renamed`, { exact: true })
    ).toBeVisible();
    await page.getByRole("tab", { name: "List" }).click();
    await (await rowMenu(renamed)).getByRole("button", { name: "Details" }).click();
    // The manifest says how a table was walked in words now, not in the API's own punctuation.
    await expect(page.locator("dialog[open]").getByText("primary key order").first()).toBeVisible();
    await page.locator("dialog[open]").getByText("Close", { exact: true }).click();
    await (await rowMenu(renamed)).getByRole("button", { name: "Delete" }).click();
    // One job per adapter (story 86): a parallel checkout or snapshot makes the first submit refuse.
    await expect(async () => {
      await page.locator("dialog[open]").getByRole("button", { name: "Delete state" }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
    await expect(stateRow(page, `${name}-renamed`)).toHaveCount(0, { timeout: 60_000 });
    expect(issues).toStrictEqual([]);
  });

  test("@story-75 @story-76 @story-77 @story-82 @story-84 @story-87 checks out the seeded baseline after a preflight and sees the stash and history", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "States" }).click();
    const row = stateRow(page, "seeded-baseline");
    await row.getByRole("button", { name: "Check out" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByText("schema matches").first()).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(/atomic/).first()).toBeVisible();
    await expect(dialog.getByText("A stash state is taken first")).toBeVisible();
    await dialog.getByRole("button", { name: "Check out" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("tab", { name: "History" }).click();
    const history = page.locator("tr", { hasText: "seeded-baseline" }).first();
    // The list reports the outcome in a person's words: a succeeded job reads "restored".
    await expect(history.getByText("restored", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });
    // And every database it touched says so by name, which is the whole point of story 84.
    await expect(history.getByText(/^\S.*: restored$/).first()).toBeVisible();
    await page.getByRole("tab", { name: "States" }).click();
    await page.getByRole("switch", { name: "Show stashes" }).click();
    await expect(stateRow(page, "stash").first()).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-80 @story-81 checkout history opens per-adapter results and the counters step with repair", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "History" }).click();
    const history = page.locator("tr", { hasText: "seeded-baseline" }).first();
    await expect(history.getByRole("button", { name: "Retry" })).toBeDisabled();
    await history.getByRole("button", { name: "Details" }).click();
    const detail = page.locator("dialog[open]");
    await expect(
      detail.getByRole("heading", { name: /Checkout of seeded-baseline/ })
    ).toBeVisible();
    await expect(detail.getByText("restored").first()).toBeVisible();
    await expect(detail.getByText(/FKs/).first()).toBeVisible();
    await detail.getByText("Close", { exact: true }).click();
    await history.getByRole("button", { name: "Counters" }).click();
    const counters = page.locator("dialog[open]");
    await expect(counters.getByText(/\d+ ok · 0 failed/)).toBeVisible();
    await counters.getByRole("button", { name: "Repair counters" }).click();
    await expect(counters.getByText(/\d+ ok · 0 failed/)).toBeVisible();
    await counters.getByText("Close", { exact: true }).click();
    expect(issues).toStrictEqual([]);
  });
  test("@story-88 @story-89 @story-90 @story-91 @story-92 compares the baseline with the live database after an insert, drills into the table, and exports", async ({
    page,
  }) => {
    test.setTimeout(120_000);
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
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "Diffs" }).click();
    await page.getByRole("button", { name: "New diff" }).click();
    const create = page.locator("dialog[open]");
    await create.getByLabel("Base state").selectOption({ label: "seeded-baseline" });
    await create.getByLabel("Target").selectOption({ label: "live database" });
    await create.getByRole("button", { name: "Compare" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const row = page.locator("tr", { hasText: "live database" }).first();
    await expect(row.getByText("ready")).toBeVisible({ timeout: 90_000 });
    await row.getByRole("button", { name: "Details" }).click();
    const detail = page.locator("dialog[open]");
    await expect(detail.getByText(/primary-key|row-hash/).first()).toBeVisible();
    const customers = detail.locator("tr", { hasText: table.replace(/^public\./, "") }).first();
    await expect(customers.getByRole("cell").nth(2)).toHaveText(/^[1-9]\d*$/);
    await customers.getByRole("button", { name: "Rows" }).click();
    const rows = page.locator("dialog[open]").last();
    await expect(rows.getByText("added").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    // Export and delete moved into the row's overflow; Details is the only control still out front.
    const menu = await rowMenu(row);
    const csv = await menu.getByRole("link", { name: "Export CSV" }).getAttribute("href");
    const exported = await page.request.get(String(csv));
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-type"]).toContain("text/csv");
    await menu.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("tr", { hasText: "live database" })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });
  test("@story-49 @story-52 @story-53 @story-54 @story-55 @story-56 @story-57 @story-58 @story-59 @story-60 @story-149 imports a CSV through the wizard, dry-runs, runs, and re-imports the rejected rows", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const csv = `email,balance,big\nimp-${STAMP}-1@x.io,1.5,1\nimp-${STAMP}-2@x.io,abc,2\n`;
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await firstTable(postgres.id);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "Imports" }).click();
    await page.getByRole("button", { name: "New import" }).click();
    const wizard = page.locator("dialog[open]");
    await wizard.locator('input[type="file"]').setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(wizard.getByRole("columnheader", { name: "email" })).toBeVisible();
    await wizard.getByRole("combobox", { name: "Database" }).selectOption({ label: postgres.name });
    await wizard.getByRole("combobox", { name: "Table" }).selectOption(table);
    await expect(wizard.getByLabel("email: file column")).toHaveValue("email");
    await wizard.getByLabel("email: adjust the value").selectOption("trim");
    await wizard.getByLabel("Save this mapping as").fill(`map-${STAMP}`);
    const sample = await wizard.getByRole("link", { name: "Sample CSV" }).getAttribute("href");
    expect((await page.request.get(String(sample))).status()).toBe(200);
    await wizard.getByRole("button", { name: "Preview import" }).click();
    await expect(wizard.getByText("Preview only — nothing has been imported yet.")).toBeVisible({
      timeout: 90_000,
    });
    // The counts as a sentence: one row of the two validated, the other did not (defect 1).
    await expect(wizard.getByText("1 row ready. 1 row will be rejected.")).toBeVisible();
    await expect(wizard.getByText(/row \d+: balance/)).toBeVisible();
    await wizard.getByRole("button", { name: "Import 1 row", exact: true }).click();
    await expect(wizard.getByText("Import complete.")).toBeVisible({ timeout: 90_000 });
    await expect(wizard.getByText("Imported 1 row. 1 row was rejected.")).toBeVisible();
    await expect(wizard.getByText("A stash was taken first")).toBeVisible();
    const rejected = await wizard.getByRole("link", { name: "Rejected rows" }).getAttribute("href");
    const rejectedFile = await page.request.get(String(rejected));
    expect(rejectedFile.status()).toBe(200);
    expect(await rejectedFile.text()).toContain(`imp-${STAMP}-2@x.io`);
    await wizard.getByRole("button", { name: "Done" }).click();
    const run = page
      .locator("main tbody tr", { hasText: "Imported 1 row. 1 row was rejected." })
      .first();
    await run.getByRole("button", { name: "Report" }).click();
    await expect(page.locator("dialog[open]").getByText("Import complete.")).toBeVisible();
    await page.keyboard.press("Escape");
    await run.getByRole("button", { name: "Re-import rejected" }).click();
    await expect(
      page.locator("dialog[open]").getByRole("columnheader", { name: "email" })
    ).toBeVisible();
    await page
      .locator("dialog[open]")
      .getByRole("combobox", { name: "Database" })
      .selectOption({ label: postgres.name });
    await page
      .locator("dialog[open]")
      .getByLabel("Reuse a saved mapping")
      .selectOption({ label: `map-${STAMP}` });
    await expect(page.locator("dialog[open]").getByLabel("Save this mapping as")).toHaveValue(
      `map-${STAMP}`
    );
    await page.keyboard.press("Escape");
    expect(issues).toStrictEqual([]);
  });
  test("@story-79 a checkout of a partial state leaves the adapters it does not cover untouched and says so", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    const name = `partial-${STAMP}`;
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "States" }).click();
    await page.getByRole("button", { name: "Take state" }).click();
    const take = page.locator("dialog[open]");
    await take.getByLabel("Name").fill(name);
    // Ticking one adapter turns the default "every adapter" into that subset (story 62).
    await take.locator("fieldset label", { hasText: postgres.name }).locator("input").click();
    await take.getByRole("button", { name: "Take" }).click();
    const row = stateRow(page, name);
    await ready(row);
    await expect(row).toContainText(postgres.name);
    await expect(row).not.toContainText("shop-mongo");
    await row.getByRole("button", { name: "Check out" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByText("not in state").first()).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Check out" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("tab", { name: "History" }).click();
    const history = page.locator("tr", { hasText: name }).first();
    await expect(history.getByText("restored", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(history.getByText(`${postgres.name}: restored`)).toBeVisible();
    // Untouched adapters are not checkout rows: the preflight said so, the history stays honest.
    await expect(history).not.toContainText("shop-mongo");
    await page.getByRole("tab", { name: "States" }).click();
    await (await rowMenu(row)).getByRole("button", { name: "Delete" }).click();
    await expect(async () => {
      await page.locator("dialog[open]").getByRole("button", { name: "Delete state" }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
    await expect(stateRow(page, name)).toHaveCount(0, { timeout: 60_000 });
    expect(issues).toStrictEqual([]);
  });
});

test.describe("viewer state stories", () => {
  test.use({ storageState: statePath("viewer") });

  test("@story-66 a viewer lists states with size and author but gets no state actions", async ({
    page,
  }) => {
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "States" }).click();
    await expect(stateRow(page, "seeded-baseline")).toBeVisible();
    // The footer counts the rows it is showing, so a wrong or missing count fails here.
    const rows = await page.getByRole("list", { name: "States" }).locator("li").count();
    await expect(page.getByText(new RegExp(`^${rows} states( so far)?$`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Take state" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check out" })).toHaveCount(0);
  });
});
