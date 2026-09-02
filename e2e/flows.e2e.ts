import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { apiContext, demoAdapter, firstTable } from "./lib/api.ts";
import { dataRows, rowMenu, settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

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
    const editedRow = page.locator("tr", { hasText: "e2e-edited@x.io" });
    await (await rowMenu(editedRow)).getByRole("button", { name: "Delete row" }).click();
    await expect(page.getByText("e2e-edited@x.io")).toHaveCount(0);
    await page.getByRole("switch", { name: "Write mode" }).click();
    await expect(page.getByRole("button", { name: "Insert row" })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-94 an empty listing says so and the footer counts what is there", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const storage = await demoAdapter({ kind: "storage" });
    await page.goto(`/projects/demo/adapters/${storage.id}/files`);
    await settle(page);
    const rows = await dataRows(page).count();
    await expect(page.getByText(new RegExp(`^${rows} entries( so far)?$`))).toBeVisible();
    await page.getByPlaceholder("Search files...").fill("no-such-file-anywhere");
    await settle(page);
    await expect(page.getByText('No files match "no-such-file-anywhere".')).toBeVisible();
    await expect(page.getByText("0 entries")).toBeVisible();
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
    // The seed writes exactly one file, imports/customers.csv (ops.seeds.ts), so the root holds one
    // folder and that folder holds one file: entries are buttons now, not anchors, and carry no
    // trailing slash.
    await page.getByRole("button", { name: "imports" }).click();
    await settle(page);
    await page.getByRole("button", { name: "customers.csv" }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.locator("dialog[open]").getByText("Close", { exact: true }).click();
    expect(issues).toStrictEqual([]);
  });

  test("@story-93 @story-95 makes a folder, renames a file into it, and deletes a batch", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const storage = await demoAdapter({ kind: "storage" });
    // The seeded store is read_only, which is the default and the reason nothing writes to a file
    // store by accident. An admin loosens it, and puts it back so the rest of the suite finds the
    // store it expects.
    const admin = await apiContext("admin");
    await admin.post(`projects/demo/adapters/${storage.id}/mode`, { data: { mode: "sandbox" } });
    try {
      await page.goto(`/projects/demo/adapters/${storage.id}/files`);
      await settle(page);
      await page.getByRole("button", { name: "New folder" }).click();
      await page.locator("dialog[open]").getByLabel("Folder name").fill(`e2e-${STAMP}`);
      await page.locator("dialog[open]").getByRole("button", { name: "Create" }).click();
      const folder = page.getByRole("button", { name: `e2e-${STAMP}`, exact: true });
      await expect(folder).toBeVisible();

      // A rename asks for a name, and the file stays in the folder it is in.
      const upload = page.locator('input[type="file"]');
      await upload.setInputFiles({
        name: "batch-a.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("a"),
      });
      // Exact: the row also holds "Rename batch-a.txt" and "Delete batch-a.txt".
      await expect(page.getByRole("button", { name: "batch-a.txt", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Rename batch-a.txt" }).click();
      await page.locator("dialog[open]").getByLabel("New name").fill(`batch-b-${STAMP}.txt`);
      await page.locator("dialog[open]").getByRole("button", { name: "Rename" }).click();
      await expect(
        page.getByRole("button", { name: `batch-b-${STAMP}.txt`, exact: true })
      ).toBeVisible();

      // Two ticks, one press, and the empty folder goes with the file.
      await page.getByRole("checkbox", { name: `Select batch-b-${STAMP}.txt` }).check();
      await page.getByRole("checkbox", { name: `Select e2e-${STAMP}` }).check();
      await expect(page.getByText("2 entries selected.")).toBeVisible();
      await page.getByRole("button", { name: "Delete selected" }).click();
      await page.locator("dialog[open]").getByRole("button", { name: "Delete" }).click();
      await expect(
        page.getByRole("button", { name: `batch-b-${STAMP}.txt`, exact: true })
      ).toHaveCount(0);
      await expect(folder).toHaveCount(0);
      expect(issues).toStrictEqual([]);
    } finally {
      await admin.post(`projects/demo/adapters/${storage.id}/mode`, {
        data: { mode: "read_only" },
      });
      await admin.dispose();
    }
  });
});

// Column policies are admin work now (routes.ts: masking rules moved out of a tester's way), so
// this story runs with an admin session rather than under "qa flows".
test.describe("admin data flows", () => {
  test.use({ storageState: statePath("admin") });

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
    await expect(page.locator("tr", { hasText: "e2e.user" })).toBeVisible();
    await page.goto("/tokens");
    await settle(page);
    await page.getByRole("button", { name: "New token" }).click();
    await page.locator("dialog[open]").getByLabel("Name").fill("e2e token");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(/tst_/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("tr", { hasText: "e2e token" })).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});
