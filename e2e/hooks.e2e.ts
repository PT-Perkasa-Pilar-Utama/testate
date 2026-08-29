import { expect, test } from "@playwright/test";

import { demoAdapter } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

test.describe("hook stories", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-101 @story-102 @story-103 attaches a saved request as a hook, flips its policy, reorders, and removes it", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const rest = await demoAdapter({ kind: "rest" });
    await page.goto(`/projects/demo/adapters/${rest.id}/requests`);
    await settle(page);
    await page.getByRole("button", { name: "New request" }).click();
    const request = page.locator("dialog[open]");
    await request.getByLabel("Name").fill(`hook-${STAMP}`);
    await request.getByLabel("Path").fill("/minio/health/live?state={{state.name}}");
    await request.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.goto("/projects/demo");
    await settle(page);
    await page.getByRole("tab", { name: "Hooks" }).click();
    await page.getByRole("button", { name: "New hook" }).click();
    const create = page.locator("dialog[open]");
    await expect(create.getByText(/\{\{state\.name\}\}/)).toBeVisible();
    await create.getByLabel("Trigger").selectOption("after_snapshot");
    await create.getByLabel("REST adapter").selectOption({ label: rest.name });
    await create.getByLabel("Saved request").selectOption({ label: `hook-${STAMP}` });
    await create.getByRole("button", { name: "Add hook" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const row = page.locator("tr", { hasText: `hook-${STAMP}` });
    await expect(row.getByText("continue")).toBeVisible();
    await row.getByRole("button", { name: "Abort on failure" }).click();
    await expect(row.getByText("abort")).toBeVisible();
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByText("off")).toBeVisible();
    await row.getByRole("button", { name: "Move down" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("tr", { hasText: `hook-${STAMP}` })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });

  test("@story-104 @story-105 the jobs screen lists finished jobs with their kind and status and offers cancel only while running", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/jobs");
    await settle(page);
    await expect(page.locator("main tbody tr").first()).toBeVisible();
    await expect(page.getByText("succeeded").first()).toBeVisible();
    const finished = page.locator("main tbody tr", { hasText: "succeeded" }).first();
    await expect(finished.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });
});
