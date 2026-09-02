import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { openStatesList, rowMenu, settle, stateRow, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";
import { runSql } from "./lib/sql.ts";

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
    await openStatesList(page);
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

  test("@story-12 @story-75 @story-76 @story-77 @story-82 @story-84 @story-87 @story-152 checks out the seeded baseline, sees the stash and history, and is told when the databases move off HEAD", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects/demo");
    await settle(page);
    await openStatesList(page);
    const row = stateRow(page, "seeded-baseline");
    await row.getByRole("button", { name: "Check out" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByText("schema matches").first()).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(/atomic/).first()).toBeVisible();
    await expect(dialog.getByText("A stash state is taken first")).toBeVisible();
    await dialog.getByRole("button", { name: "Check out" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("tab", { name: "Activity" }).click();
    const history = page.locator("tr", { hasText: "seeded-baseline" }).first();
    // The list reports the job's own status word, capitalized: a succeeded checkout reads "Succeeded".
    await expect(history.getByText("Succeeded", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });
    // And every database it touched says so by name, which is the whole point of story 84.
    await expect(history.getByText(/^\S.*: Restored$/).first()).toBeVisible();
    await openStatesList(page);
    await page.getByRole("switch", { name: "Show stashes" }).click();
    await expect(stateRow(page, "stash").first()).toBeVisible();
    // The checkout put the databases on this state, and both the row and the header say so.
    await expect(row.getByText("HEAD", { exact: true })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Quota" })).toBeVisible();
    // A write Testate never saw: straight into the engine, past the API. This is the one place
    // the suite touches the shared `shop` on purpose; a private database has no HEAD to drift from.
    runSql("shop", [
      "UPDATE contract.customers SET balance = balance + 1 WHERE id = (SELECT min(id) FROM contract.customers)",
    ]);
    await (await rowMenu(row)).getByRole("button", { name: "Check for changes" }).click();
    await expect(page.getByText("The databases have changed since seeded-baseline.")).toBeVisible({
      timeout: 60_000,
    });
    await expect(row.getByText("HEAD · modified")).toBeVisible();
    await expect(page.getByText("seeded-baseline · modified")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-80 @story-81 checkout history opens per-adapter results and the counters step with repair", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "Activity" }).click();
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
    // Ticking one state and comparing it with live replaces the New diff dialog.
    await page.getByRole("tab", { name: "List" }).click();
    await page.getByRole("checkbox", { name: "Compare seeded-baseline" }).check();
    await page.getByRole("button", { name: "Compare with live" }).click();
    await page.getByRole("tab", { name: "Activity" }).click();
    const row = page.locator("tr", { hasText: "live database" }).first();
    await expect(row.getByText("ready")).toBeVisible({ timeout: 90_000 });
    // Details is a page of its own now: a rail of tables on the left, both sides of every row on
    // the right, and a changed cell opens the value in full.
    await row.getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(/\/projects\/demo\/diffs\//);
    const short = table.replace(/^public\./, "");
    await page
      .getByRole("button", { name: new RegExp(short) })
      .first()
      .click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("A tinted cell changed")).toBeVisible();
    await page.getByLabel("Breadcrumb").getByRole("link", { name: "activity" }).click();
    await settle(page);
    // Export and delete moved into the row's overflow; Details is the only control still out front.
    const menu = await rowMenu(row);
    const csv = await menu.getByRole("link", { name: "Export CSV" }).getAttribute("href");
    const exported = await page.request.get(String(csv));
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-type"]).toContain("text/csv");
    // One fewer, not none: the drift check two tests up left a live comparison of its own.
    const before = await page.locator("tr", { hasText: "live database" }).count();
    await menu.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("tr", { hasText: "live database" })).toHaveCount(before - 1);
    expect(issues).toStrictEqual([]);
  });
  test("@story-49 @story-52 @story-53 @story-54 @story-55 @story-56 @story-57 @story-58 @story-59 @story-60 @story-149 checks a file before importing it, saves the normalizer, and re-imports what the run rejected", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const bad = `email,balance,big\nimp-${STAMP}-1@x.io,not-a-number,1\n`;
    // The same address twice. Both rows are the right shape, so the check passes them; the column
    // is UNIQUE, and a unique constraint is the real run's to find (PRD 56). That is how one press
    // can end in "1 imported, 1 rejected" with a file the check called clean.
    const good = `email,balance,big\nimp-${STAMP}-2@x.io,1.5,1\nimp-${STAMP}-2@x.io,2.5,2\n`;
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await firstTable(postgres.id);
    // Importing belongs to the database it writes into, so it is that adapter's own screen now
    // and no longer a wizard over the project.
    await page.goto(`/projects/demo/adapters/${postgres.id}/imports`);
    await settle(page);
    const pick = async (name: string, body: string): Promise<void> => {
      await page.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: "text/csv",
        buffer: Buffer.from(body),
      });
      await expect(page.getByRole("columnheader", { name: "email" })).toBeVisible();
      await page.getByLabel(/^Table/).selectOption(table);
    };

    await pick("wrong.csv", bad);
    await expect(page.getByText(/\d+ of \d+ columns matched by name/)).toBeVisible();
    const sample = await page.getByRole("link", { name: "Sample CSV" }).getAttribute("href");
    expect((await page.request.get(String(sample))).status()).toBe(200);
    // Nothing is written until the check says the file is right, and the check is what opens it.
    const importButton = page.getByRole("button", { name: "Import", exact: true });
    await expect(importButton).toBeDisabled();
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByText("0 rows ready. 1 row will be rejected.")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("Fix the file and check it again.")).toBeVisible();
    await expect(importButton).toBeDisabled();

    // Fixing it is loading the right file, and that puts the guard back: a new file has not been
    // checked, whatever the last one answered.
    await pick("right.csv", good);
    await expect(importButton).toBeDisabled();
    // Named, so it can be picked again next week. The name lives inside the table: another table
    // of this same database may keep one called the same thing.
    await page.getByLabel("Save this as").fill(`weekly-${STAMP}`);
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByText("All 2 rows look ready to import.")).toBeVisible({
      timeout: 90_000,
    });
    await expect(importButton).toBeEnabled();
    await importButton.click();
    await expect(page.getByText("Imported 1 row. 1 row was rejected.")).toBeVisible({
      timeout: 90_000,
    });

    // What landed, read back from the list of runs the project keeps.
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "Activity" }).click();
    const run = page
      .locator("main tbody tr", { hasText: "Imported 1 row. 1 row was rejected." })
      .first();
    await run.getByRole("button", { name: "Report" }).click();
    const report = page.locator("dialog[open]");
    await expect(report.getByText("Import complete.")).toBeVisible();
    await expect(report.getByText("A stash was taken first")).toBeVisible();
    const rejected = await report.getByRole("link", { name: "Rejected rows" }).getAttribute("href");
    const rejectedFile = await page.request.get(String(rejected));
    expect(rejectedFile.status()).toBe(200);
    expect(await rejectedFile.text()).toContain(`imp-${STAMP}-2@x.io`);
    await page.keyboard.press("Escape");

    // Re-import opens the same screen with the rejected rows as the source, so a partial failure
    // is fixed and sent again rather than reprocessed whole.
    await run.getByRole("link", { name: "Re-import rejected" }).click();
    await settle(page);
    await expect(page.getByText("The rows an earlier run rejected are the source.")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "email" })).toBeVisible();

    // The normalizer that run saved is offered back, on the table it was saved for.
    await page.goto(`/projects/demo/adapters/${postgres.id}/imports`);
    await settle(page);
    await pick("again.csv", good);
    await page.getByLabel("Reuse a saved normalizer").selectOption({ label: `weekly-${STAMP}` });
    await expect(page.getByLabel("Save this as")).toHaveValue(`weekly-${STAMP}`);
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
    await openStatesList(page);
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
    await page.getByRole("tab", { name: "Activity" }).click();
    const history = page.locator("tr", { hasText: name }).first();
    await expect(history.getByText("Succeeded", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(history.getByText(`${postgres.name}: Restored`)).toBeVisible();
    // Untouched adapters are not checkout rows: the preflight said so, the history stays honest.
    await expect(history).not.toContainText("shop-mongo");
    await openStatesList(page);
    await (await rowMenu(row)).getByRole("button", { name: "Delete" }).click();
    await expect(async () => {
      await page.locator("dialog[open]").getByRole("button", { name: "Delete state" }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
    await expect(stateRow(page, name)).toHaveCount(0, { timeout: 60_000 });
    expect(issues).toStrictEqual([]);
  });
});
