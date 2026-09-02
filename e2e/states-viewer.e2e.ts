import { expect, test } from "@playwright/test";

import { openStatesList, settle, stateRow } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

// A viewer only reads here, so this file runs beside states.e2e.ts without racing its jobs; it is
// its own file because that spec is at the line ceiling.
test.describe("viewer state stories", () => {
  test.use({ storageState: statePath("viewer") });

  test("@story-66 a viewer lists states with size and author but gets no state actions", async ({
    page,
  }) => {
    await page.goto("/projects/demo");
    await settle(page);
    await openStatesList(page);
    await expect(stateRow(page, "seeded-baseline")).toBeVisible();
    // The footer counts the rows it is showing, so a wrong or missing count fails here.
    const rows = await page.getByRole("list", { name: "States" }).locator("li").count();
    await expect(page.getByText(new RegExp(`^${rows} states( so far)?$`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Take state" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check out" })).toHaveCount(0);
  });
});
