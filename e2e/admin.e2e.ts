import { expect, test } from "@playwright/test";

import { demoAdapter } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

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
    // The modal says what goes before it takes the slug: the restore, and the rows behind it.
    await expect(plan.getByText(/returns to its init state/)).toBeVisible();
    await expect(plan.getByText(/not stashed/)).toBeVisible();
    await expect(plan.getByText(/The project holds nothing yet\.|will be deleted/)).toBeVisible();
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
  test("@story-120 an admin edits a retention setting and the value survives a reload", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/settings");
    await settle(page);
    const field = page.getByLabel("retention.stash_keep");
    const before = Number(await field.inputValue());
    await field.fill(String(before + 1));
    await page.getByRole("button", { name: "Save retention" }).click();
    await expect(page.getByText("retention saved")).toBeVisible();
    await page.reload();
    await settle(page);
    await expect(page.getByLabel("retention.stash_keep")).toHaveValue(String(before + 1));
    await page.getByLabel("retention.stash_keep").fill(String(before));
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
    await dialog.getByLabel("Endpoint (optional)", { exact: true }).fill("http://127.0.0.1:9010");
    await dialog.getByLabel("Access key id", { exact: true }).fill("testate");
    await dialog.getByLabel("Secret access key", { exact: true }).fill("testate-minio");
    await dialog.getByRole("switch", { name: /Virtual-hosted/ }).click();
    await dialog.getByRole("button", { name: "Start migration" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByText("Store migration succeeded").first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator("main").getByText("s3", { exact: true })).toBeVisible();
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
    await expect(page.locator("main").getByText("local", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Run backup" }).click();
    const download = page.getByRole("link", { name: "Download backup" });
    await expect(download).toBeVisible({ timeout: 60_000 });
    const archive = await page.request.get(String(await download.getAttribute("href")));
    expect(archive.status()).toBe(200);
    expect(archive.headers()["content-type"]).toContain("application/x-tar");
    expect(issues).toStrictEqual([]);
  });
});
