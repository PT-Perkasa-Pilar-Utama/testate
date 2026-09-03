import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { apiContext, demoAdapter } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

/**
 * The mask dialog names its exact target ("Mask for public.users.email", policies.view.tsx),
 * so read that back instead of guessing a table from row order. The column never holds a dot; the
 * table might (schema.table), so the split takes the last dot.
 */
function parsePolicyDialogTitle(title: string | null) {
  const match = /^Mask for (.+)\.([^.]+)$/.exec(title ?? "");
  const table = match?.[1];
  const column = match?.[2];
  if (table === undefined || column === undefined) {
    throw new Error(`could not read table/column from dialog title "${String(title)}"`);
  }
  return { table, column };
}

/** The driver named on the settings store card, which is a span and not the dialog's option. */
function storeBadge(page: Page, label: string): Locator {
  return page.locator("main span").filter({ hasText: new RegExp(`^${label}$`) });
}

/**
 * The discard prompt, which is one of two dialogs open at that moment: the form it is holding on
 * to is the other. Every form dialog on a screen carries one of these, and a closed `<dialog>` is
 * still in the page, so it is named by what it says rather than by being the only one.
 */
function asking(page: Page): Locator {
  return page.locator("dialog[open]").filter({ hasText: "Discard changes?" });
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
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator("tr", { hasText: `fresh-${STAMP}` })).toBeVisible();
    // The admin session is dropped so the same page becomes the new user's browser.
    await page.context().clearCookies();
    await page.goto("/projects");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
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
    // No slug field any more: the API derives it from the name, so `Gone abc` becomes `gone-abc`.
    await page.locator("dialog[open]").getByLabel("Name").fill(`Gone ${STAMP}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("link", { name: `Gone ${STAMP}` }).click();
    await settle(page);
    // Edit and Delete sit behind the project's gear now, beside Take state.
    await page.getByRole("button", { name: "Project settings" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    // The quota is a ladder now: step 1 is 1 GiB, step 0 leaves the project on the instance default.
    await page.locator("dialog[open]").getByLabel("Snapshot quota").fill("1");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    // The quota chip (project.view.tsx QuotaChip) reports bytes on a meter, not a percentage;
    // check the meter itself picked up the new 1 GiB ceiling.
    await expect(page.getByRole("meter", { name: "Quota" })).toHaveAttribute(
      "aria-valuemax",
      "1073741824"
    );
    await page.getByRole("button", { name: "Project settings" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    const plan = page.locator("dialog[open]");
    // The modal says what goes before it takes the slug: the restore, what the delete takes with
    // it, and the rows behind that.
    await expect(plan.getByText(/returns to its starting point/)).toBeVisible();
    await expect(plan.getByText(/gone for good/)).toBeVisible();
    await expect(plan.getByText(/The project holds nothing yet\.|will be deleted/)).toBeVisible();
    const confirm = plan.getByRole("button", { name: "Restore and delete" });
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
    const path = `/projects/demo/adapters/${postgres.id}/masks`;
    await page.goto(path);
    await settle(page);
    const row = page.locator("tr", { hasText: "email" }).first();
    await row.getByRole("button", { name: "Add" }).click();
    const target = parsePolicyDialogTitle(
      await page.locator("dialog[open]").getByRole("heading", { level: 2 }).textContent()
    );
    await page.locator("dialog[open]").getByLabel("Mask").selectOption("redact");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("mask redact")).toBeVisible();
    await row.getByRole("button", { name: "Lock" }).click();
    await expect(row.getByText("locked")).toBeVisible();

    // The screen moved behind `admin` ("keep the engine, hide the screen"), so
    // qa gets the role banner, not the table — checking for a missing Remove button would now pass
    // whether or not locking still works. Hit the engine directly instead: the router lets qa
    // through the DELETE (data.router.ts requireRole("qa")); only the lock check in
    // data.policies.ts refuses it.
    const qa = await browser.newContext({ storageState: statePath("qa") });
    const qaPage = await qa.newPage();
    await qaPage.goto(path);
    await settle(qaPage);
    await expect(qaPage.getByText("Your role cannot open this page.")).toBeVisible();
    await expect(qaPage.locator("tr", { hasText: "email" })).toHaveCount(0);
    await qa.close();
    const qaApi = await apiContext("qa");
    const denied = await qaApi.delete(
      `projects/demo/adapters/${postgres.id}/policies/${encodeURIComponent(target.table)}/${encodeURIComponent(target.column)}`
    );
    expect(denied.status()).toBe(403);
    await qaApi.dispose();

    await row.getByRole("button", { name: "Unlock" }).click();
    await expect(row.getByText("locked")).toHaveCount(0);
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row.getByText("mask redact")).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });
  test("@story-120 an admin edits a retention setting and the value survives a reload", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/settings");
    await settle(page);
    // Labels were rewritten into plain language (settings.view.tsx LABELS); the raw key never
    // reaches the screen.
    const field = page.getByLabel("Stashes to keep");
    const before = Number(await field.inputValue());
    await field.fill(String(before + 1));
    await page.getByRole("button", { name: "Save retention" }).click();
    await expect(page.getByText("retention saved")).toBeVisible();
    await page.reload();
    await settle(page);
    await expect(page.getByLabel("Stashes to keep")).toHaveValue(String(before + 1));
    await page.getByLabel("Stashes to keep").fill(String(before));
    await page.getByRole("button", { name: "Save retention" }).click();
    await expect(page.getByText("retention saved")).toBeVisible();
    expect(issues).toStrictEqual([]);
  });

  test("@story-118 @story-119 @story-121 migrates the snapshot store to MinIO and back, then runs a backup", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/settings");
    await settle(page);
    await page.getByRole("button", { name: "Migrate store" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("combobox", { name: "Target" }).selectOption("s3");
    await dialog.getByLabel("Bucket", { exact: true }).fill("exports");
    await dialog.getByLabel("Prefix", { exact: true }).fill(`store-${STAMP}/`);
    // The label says "Endpoint"; whether it is optional is a marker beside it, not part of its name.
    await dialog.getByLabel("Endpoint", { exact: true }).fill("http://127.0.0.1:9010");
    await dialog.getByLabel("Access key id", { exact: true }).fill("testate");
    await dialog.getByLabel("Secret access key", { exact: true }).fill("testate-minio");
    await dialog.getByRole("switch", { name: /Virtual-hosted/ }).click();
    await dialog.getByRole("button", { name: "Start migration" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByText("Store migration succeeded").first()).toBeVisible({
      timeout: 120_000,
    });
    // The store card names the driver in words now; "S3" is the badge, not the stored "s3". The
    // badge is a span: the migrate dialog holds an <option> of the same words, and a closed dialog
    // is still in the DOM, so an unscoped text match resolves to two.
    await expect(storeBadge(page, "S3")).toBeVisible();
    await page.getByRole("button", { name: "Migrate store" }).click();
    await page
      .locator("dialog[open]")
      .getByRole("combobox", { name: "Target" })
      .selectOption("local");
    await page.locator("dialog[open]").getByRole("button", { name: "Start migration" }).click();
    // The first toast may still be on screen; the second migration adds one of its own.
    await expect(page.getByText("Store migration succeeded").nth(1)).toBeVisible({
      timeout: 120_000,
    });
    await expect(storeBadge(page, "Local disk")).toBeVisible();
    await page.getByRole("button", { name: "Run backup" }).click();
    const download = page.getByRole("link", { name: "Download backup" });
    await expect(download).toBeVisible({ timeout: 60_000 });
    const archive = await page.request.get(String(await download.getAttribute("href")));
    expect(archive.status()).toBe(200);
    expect(archive.headers()["content-type"]).toContain("application/x-tar");
    expect(issues).toStrictEqual([]);
  });
});

test.describe("leaving a form", () => {
  test.use({ storageState: statePath("admin") });

  test("a form with something typed in it asks before it is thrown away", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    // Untouched: closing says nothing, because there is nothing to lose.
    await page.getByRole("button", { name: "New user" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // Typed in: Escape asks, and Keep editing leaves every keystroke where it was.
    await page.getByRole("button", { name: "New user" }).click();
    await page.locator("dialog[open]").getByLabel("Username").fill(`guard-${STAMP}`);
    await page.keyboard.press("Escape");
    await expect(asking(page)).toBeVisible();
    await asking(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Username")).toHaveValue(`guard-${STAMP}`);

    // The ✕ goes the same way, and Discard is the only thing that closes it.
    await page.getByRole("button", { name: "Close" }).first().click();
    await expect(asking(page)).toBeVisible();
    await asking(page).getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    // Every Solid diagnostic on this path counts: the two the dialog used to raise came from the
    // native open and close moving focus inside an effect callback, and `dialog.tsx` now does
    // both on the next turn.
    expect(issues).toStrictEqual([]);
  });
});
