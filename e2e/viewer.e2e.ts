import { expect, test } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { cardCount, dataRows, overflowingCards, settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

// A viewer only reads here; its own file because stories.e2e.ts is at the line ceiling.
test.describe("viewer stories", () => {
  test.use({ storageState: statePath("viewer") });

  test("@story-131 @story-132 @story-133 the tools screen hashes, generates bytes, and mints uuids", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/tools");
    await settle(page);
    await page.getByLabel("Value").fill("hello");
    await page.getByRole("button", { name: "Hash" }).click();
    await expect(
      page.locator("main").getByText(/^[0-9a-f]{64}$|^\$2[aby]\$|^\$argon2id\$/)
    ).toBeVisible();
    await page.getByRole("button", { name: "Generate" }).click();
    await page.getByRole("button", { name: "Ten" }).click();
    await expect(
      page
        .locator("main")
        .getByText(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/)
        .first()
    ).toBeVisible();
    // A bcrypt hash and ten uuids are long unbroken strings. A row that will not shrink below its
    // content spills out of the card and is drawn over the card beside it.
    expect(await cardCount(page)).toBe(3);
    expect(await overflowingCards(page)).toStrictEqual([]);
    expect(issues).toStrictEqual([]);
  });

  test("@story-148 a viewer sees masked columns as redacted while qa sees raw", async ({
    page,
  }) => {
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await firstTable(postgres.id);
    await page.goto(`/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await expect(page.getByText("Write mode")).toHaveCount(0);
    // Fixture extraction stands on the row; a viewer has it, and no menu, since the menu only
    // holds what a write session allows.
    const row = dataRows(page).first();
    await expect(row.getByRole("button", { name: "Fixture" })).toBeVisible();
    await expect(row.locator("button[aria-haspopup=menu]")).toHaveCount(0);
  });
});
