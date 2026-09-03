import { expect, test } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { openTab, rowMenu, settle, watch } from "./lib/crawl.ts";
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
    // The URL preview says what the name will become; the API is what decides it.
    await expect(dialog.getByLabel("URL")).toHaveValue(`/projects/e2e-${STAMP}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("link", { name: `E2E ${STAMP}` }).click();
    await settle(page);
    await expect(page.getByRole("heading", { name: `E2E ${STAMP}` })).toBeVisible();
    await expect(page.getByText("HEAD", { exact: true })).toBeVisible();
    await expect(page.getByText(`e2e-${STAMP}`, { exact: true })).toBeVisible();
    // A project opens on States now, so its empty case needs no tab switch; every other tab's is
    // every table's empty case: it used to be a header row over blank space, and the demo project
    // the rest of the suite runs against is never empty enough to show it.
    await expect(page.getByText("No databases yet.")).toBeVisible();
    // Activity shows one list at a time, so each chip shows its own empty case.
    await openTab(page, "Activity");
    for (const [chip, message] of [
      ["Imports", "No imports yet."],
      ["Diffs", "No diffs yet."],
      ["Checkouts", "No restores yet."],
    ] as const) {
      await page.getByRole("tab", { name: chip }).click();
      await expect(page.getByText(message)).toBeVisible();
    }
    await openTab(page, "Databases");
    await expect(page.getByText("No adapters yet.")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-17 @story-18 @story-19 @story-21 tests and adds a Postgres adapter from the dialog", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/projects/demo?tab=adapters");
    await settle(page);
    await page.getByRole("button", { name: "New adapter" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Name").fill(`pg-${STAMP}`);
    await dialog.getByLabel("Host").fill("127.0.0.1");
    await dialog.getByLabel("Port").fill("15432");
    await dialog.getByRole("textbox", { name: "Database" }).fill("shop");
    await dialog.getByLabel("User").fill("testate");
    await dialog.getByLabel("Password").fill("testate");
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog.getByText(/PostgreSQL 1\d/)).toBeVisible({ timeout: 15_000 });
    // The seeded adapter already tracks this database, and two on one target collide.
    await expect(dialog.getByText(/already tracks this database/)).toBeVisible();
    await page.getByRole("button", { name: "Create", exact: true }).click();
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
    // Sample fills every box from the collection's documents, and what it fills runs.
    await page.getByRole("button", { name: "Sample" }).click();
    await expect(page.getByLabel("Collection")).not.toHaveValue("");
    await expect(page.getByLabel("Filter (JSON)")).not.toContainText("$options");
    await page.getByRole("button", { name: "Run (read-only)" }).click();
    await expect(page.getByText(/\d+ row\(s\)/)).toBeVisible();
    await expect(page.getByText(/read-only credential|application filter only/)).toBeVisible();
    await page.goto(`/projects/demo/adapters/${mongo.id}`);
    await settle(page);
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Diagram" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import a file" })).toHaveCount(0);
    // The collections are browsed on this page: a pick swaps the documents and keeps the URL.
    await page.getByRole("button", { name: "orders", exact: true }).click();
    await expect(page.getByRole("region", { name: "orders", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/adapters/${mongo.id}$`));
    await expect(page.getByRole("region", { name: "Fields of the document" })).toContainText(
      "_id:"
    );
    const table = await firstTable(mongo.id);
    await page.goto(`/projects/demo/adapters/${mongo.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await expect(page.getByText("Write mode")).toHaveCount(0);
    await expect(page.getByText("Editing needs the Tabular tier.")).toHaveCount(0);
    const fields = page.getByRole("region", { name: "Fields of the document" });
    await expect(fields).toContainText("_id:");
    await expect(fields).not.toContainText("$oid");
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
    // Fixture and Delete moved into the row's overflow menu; Edit is the only action left plain.
    await row.getByRole("button", { name: "Fixture" }).click();
    await expect(page.locator("dialog[open]").getByText(/INSERT INTO/)).toBeVisible();
    await page.locator("dialog[open]").getByText("Close", { exact: true }).click();
    // Wait for each delete to land before clicking the next: the grid reloads between them.
    for (const remaining of [before + 1, before]) {
      const target = page.locator("main tbody tr", { hasText: uuidV7 }).first();
      await (await rowMenu(target)).getByRole("button", { name: "Delete row" }).click();
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
    // Entries are buttons now, not anchors; the dev seed's only object is imports/customers.csv,
    // so root shows exactly one folder named for that prefix.
    await page.getByRole("button", { name: "imports" }).click();
    await settle(page);
    const href = await page.locator("main a", { hasText: "Download" }).first().getAttribute("href");
    expect(href).toContain("/entries/download?path=");
    const response = await page.request.get(String(href));
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");
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
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const row = page.locator("tr", { hasText: `tmp-${STAMP}` });
    await expect(row).toBeVisible();
    // Edit stays in the row; everything else moved behind the row's overflow menu. The badge is
    // what says the toggle landed: the menu item's own label flips from the same refresh, so
    // reopening the menu on the click alone is a race the list wins about one run in ten.
    await (await rowMenu(row)).getByRole("button", { name: "Disable" }).click();
    await expect(row.getByText("disabled", { exact: true })).toBeVisible();
    await (await rowMenu(row)).getByRole("button", { name: "Enable" }).click();
    await expect(row.getByText("disabled", { exact: true })).toHaveCount(0);
    await (await rowMenu(row)).getByRole("button", { name: "Reset password" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel(/Temporary password/).fill("tmp-reset-password-1");
    await dialog.getByRole("button", { name: "Reset" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-151 changes a user's display name and role", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    await page.getByRole("button", { name: "New user" }).click();
    const create = page.locator("dialog[open]");
    await create.getByLabel("Username").fill(`edit-${STAMP}`);
    await create.getByLabel("Display name").fill("Before");
    await create
      .getByLabel(/password/i)
      .first()
      .fill("edit-temporary-1234");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const row = page.locator("tr", { hasText: `edit-${STAMP}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Guest");

    // Exact: the row's overflow menu is named after the account, and this run's account is
    // called edit-<stamp>, which a substring match reads as an Edit button of its own.
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.locator("dialog[open]");
    // The dialog carries the row it was opened on, which is the half of this that used to be
    // impossible: the API took the change and nothing on any screen sent it one.
    await expect(edit.getByLabel("Display name")).toHaveValue("Before");
    await edit.getByLabel("Display name").fill("After");
    await edit.getByLabel("Role").selectOption("qa");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(row).toContainText("After");
    await expect(row).toContainText("Tester");
    expect(issues).toStrictEqual([]);
  });

  test("@story-112 revokes a token and the list shows it revoked", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/tokens");
    await settle(page);
    await page.getByRole("button", { name: "New token" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill(`revoke-${STAMP}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: "Done" }).click();
    const row = page.locator("tr", { hasText: `revoke-${STAMP}` });
    await row.getByRole("button", { name: "Revoke" }).click();
    // The app asks in its own dialog now, not the browser's.
    await page.locator("dialog[open]").getByRole("button", { name: "Revoke the token" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
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
    // The filters reach the API, which has taken them since it was written. They sit behind the
    // toggle now: most visits to a log are unfiltered, and four empty boxes over every one of
    // them was a row of the page spent on nothing.
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByLabel("Action").fill("auth.login");
    await expect(page.getByText("auth.login").first()).toBeVisible();
    await page.getByLabel("Action").fill("nothing.matches.this");
    // A filter that matches nothing reads differently from a log with nothing in it at all.
    await expect(page.getByText("No rows match this filter.")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-119 the settings screen shows the deny list and saves an edit to it", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/settings");
    await settle(page);
    const deny = page.getByLabel("Blocked hosts");
    // The suite runs against loopback engines, so this instance's list is empty; put a host that
    // matches nothing in it, save, and read it back.
    await deny.fill("198.51.100.7");
    await page.getByRole("button", { name: "Save blocked hosts" }).click();
    await expect(page.getByText("netguard saved")).toBeVisible();
    await page.reload();
    await settle(page);
    await expect(page.getByLabel("Blocked hosts")).toHaveValue("198.51.100.7");
    await page.getByLabel("Blocked hosts").fill("");
    await page.getByRole("button", { name: "Save blocked hosts" }).click();
    await expect(page.getByText("netguard saved")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-121 the settings screen lists every key and marks environment-locked ones", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/settings");
    await settle(page);
    // "Snapshot store" names both a health row and the storage card, and which element each one
    // uses is presentation. The group heading names the section without depending on that.
    await expect(page.locator("main").getByRole("heading", { name: "Storage" })).toBeVisible();
    await expect(page.locator("main code").first()).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});
