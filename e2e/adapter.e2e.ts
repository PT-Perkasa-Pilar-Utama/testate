import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { openStatesList, rowMenu, settle, stateRow, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

/** An adapter's init snapshot and its deletion restore the shared database; nothing else runs meanwhile. */
/**
 * Opens the starting point's own page from the list and waits until its rail of databases names
 * the adapter: the init job adds the entry after the adapter is saved. Back on the list after.
 */
async function initHolds(page: Page, name: string): Promise<void> {
  await (await rowMenu(stateRow(page, "init"))).getByRole("link", { name: "Details" }).click();
  await expect(async () => {
    await page.reload();
    await settle(page);
    await expect(page.getByRole("navigation", { name: "Databases in this state" })).toContainText(
      name,
      { timeout: 3_000 }
    );
  }).toPass({ timeout: 60_000 });
  await page.goBack();
  await settle(page);
}

test.describe("adapter settings stories", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-23 @story-24 @story-25 @story-26 @story-27 @story-28 @story-29 @story-30 @story-31 configures, renames, and deletes an adapter through its plan", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const issues: Issue[] = [];
    watch(page, issues);
    // A project opens on States now; adapters are plumbing and no longer the front door.
    await page.goto("/projects/demo?tab=adapters");
    await settle(page);
    await page.getByRole("button", { name: "New adapter" }).click();
    const create = page.locator("dialog[open]");
    await create.getByLabel("Name").fill(`cfg-${STAMP}`);
    await create.getByLabel("Host").fill("127.0.0.1");
    await create.getByLabel("Port").fill("15432");
    await create.getByRole("textbox", { name: "Database" }).fill("shop");
    await create.getByLabel("User").fill("testate");
    await create.getByLabel("Password").fill("testate");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    // One starting point per project: the new database joins it rather than adding a row.
    await openStatesList(page);
    await expect(stateRow(page, "init")).toHaveCount(1);
    await initHolds(page, `cfg-${STAMP}`);
    await page.getByRole("tab", { name: "Databases" }).click();
    await page.getByRole("link", { name: `cfg-${STAMP}` }).click();
    await settle(page);
    await page.getByRole("button", { name: "Edit adapter" }).click();
    const edit = page.locator("dialog[open]");
    // Migration tables are excluded by the engines themselves (story 25); the list holds extras.
    await expect(edit.getByText(/excluded by default/)).toBeVisible();
    await edit.getByLabel("Name").fill(`cfg-${STAMP}-2`);
    await edit.getByLabel(/Excluded tables/).fill("contract.schema_migrations, contract.notes");
    await edit.getByLabel(/^Schemas/).fill("contract");
    await edit.getByLabel(/^Read-only password/).fill("testate");
    await edit.getByRole("button", { name: "Save adapter" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: `cfg-${STAMP}-2` })).toBeVisible();
    // On record, not only labelled: the card names the key that sealed it (story 23).
    const readOnly = page.locator("div", {
      has: page.getByText("Read-only password", { exact: true }),
    });
    await expect(readOnly.first()).toContainText("sealed under key");
    // A new host is a new target: the database's entry in the starting point is replaced, and
    // the starting point stays one row (story 28).
    await page.getByRole("button", { name: "Edit adapter" }).click();
    await page.locator("dialog[open]").getByLabel("Host").fill("localhost");
    await page.locator("dialog[open]").getByRole("button", { name: "Save adapter" }).click();
    await expect(page.getByText("init snapshot queued")).toBeVisible();
    await page.goto("/projects/demo");
    await settle(page);
    await openStatesList(page);
    await expect(stateRow(page, "init")).toHaveCount(1);
    await initHolds(page, `cfg-${STAMP}-2`);
    await page.getByRole("tab", { name: "Databases" }).click();
    await page.getByRole("link", { name: `cfg-${STAMP}-2` }).click();
    await settle(page);
    await page.getByRole("button", { name: "Delete" }).click();
    const plan = page.locator("dialog[open]");
    await expect(plan.getByText(/init state/)).toBeVisible();
    await plan.locator('button[type="submit"]').click();
    // Deleting drops you back on the tab you came from, not on the project's front door.
    await expect(page).toHaveURL(/\/projects\/demo\?tab=adapters$/);
    await settle(page);
    await expect(page.getByRole("link", { name: `cfg-${STAMP}-2` })).toHaveCount(0, {
      timeout: 60_000,
    });
    await openStatesList(page);
    // The starting point outlives the adapter (story 31): still one row, still holding its entry.
    await expect(stateRow(page, "init")).toHaveCount(1);
    await initHolds(page, `cfg-${STAMP}-2`);
    expect(issues).toStrictEqual([]);
  });
});
