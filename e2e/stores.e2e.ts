import { expect, test } from "@playwright/test";

import { apiContext } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

const STAMP = Date.now().toString(36);

function idOf(adapters: { id: string; name: string }[], name: string): string {
  const found = adapters.find((adapter) => adapter.name === name);
  if (found === undefined) throw new Error(`${name} was not created`);
  return found.id;
}

test.describe("storage screen", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-93 adds an object store to a project from the Storage screen", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/storage");
    await settle(page);
    await page.getByRole("button", { name: "New storage adapter" }).click();
    const dialog = page.locator("dialog[open]");
    // The project is the first field: the screen spans every project, so the dialog asks.
    await dialog.getByLabel("Project").selectOption({ label: "Demo" });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(`store-${STAMP}`);
    await dialog.getByRole("textbox", { name: "Bucket", exact: true }).fill("exports");
    await dialog.getByLabel("Region").fill("us-east-1");
    await dialog.getByLabel("Endpoint").fill("http://127.0.0.1:9010");
    await dialog.getByLabel("Access key id").fill("testate");
    await dialog.getByLabel("Secret access key").fill("testate-minio");
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog.getByText(/Object storage answers/)).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    // Listed under its project, as an object store.
    const row = page.locator("tr", { hasText: `store-${STAMP}` });
    await expect(row).toContainText("Object storage");
    await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
    // Gone again, through the API's own deletion plan, so the seed's store stays the only one.
    const qa = await apiContext("qa");
    const list: { data: { id: string; name: string }[] } = await (
      await qa.get("projects/demo/adapters?kind=storage")
    ).json();
    const made = idOf(list.data, `store-${STAMP}`);
    const plan: { data: { plan_id: string } } = await (
      await qa.get(`projects/demo/adapters/${made}/deletion-plan`)
    ).json();
    const removed = await qa.post(`projects/demo/adapters/${made}/deletion`, {
      data: { plan_id: plan.data.plan_id, action: "skip" },
    });
    expect(removed.status()).toBe(202);
    await qa.dispose();
    expect(issues).toStrictEqual([]);
  });
});
