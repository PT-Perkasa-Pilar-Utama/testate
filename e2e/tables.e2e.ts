import { expect, test } from "@playwright/test";

import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { USERNAMES, statePath } from "./lib/roles.ts";

/**
 * Sorting and searching, on the screen that has the accounts every run seeds. The parts are shared
 * (`components/table.tsx`, `lib/table.ts`), so a list that sorts anywhere sorts through this.
 */
test.describe("a list you can order and narrow", () => {
  test.use({ storageState: statePath("admin") });

  test("a column sorts both ways and clicking a third time gives the order back", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    const usernames = (): Promise<string[]> =>
      page.locator("tbody tr td:first-child").allInnerTexts();
    const header = page.getByRole("button", { name: "Username" });
    const original = await usernames();
    // Polled, not read: the API does the sorting now, so the rows arrive a round trip after the
    // click. Ascending really is ascending, descending is its mirror, the third click is the reset.
    await header.click();
    await expect
      .poll(usernames)
      .toStrictEqual([...original].sort((left, right) => left.localeCompare(right)));
    const up = await usernames();
    await header.click();
    await expect.poll(usernames).toStrictEqual([...up].reverse());
    await header.click();
    await expect.poll(usernames).toStrictEqual(original);
    expect(issues).toStrictEqual([]);
  });

  test("the search box keeps the rows that match and drops the rest", async ({ page }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/users");
    await settle(page);
    const first = page.locator("tbody tr td:first-child");
    await expect(first.filter({ hasText: USERNAMES.viewer })).toBeVisible();
    // Counted by which rows survive, not how many: other suites add accounts while this one runs.
    await page.getByLabel("Search users").fill(USERNAMES.qa);
    await expect(first.filter({ hasText: USERNAMES.qa })).toBeVisible();
    await expect(first.filter({ hasText: USERNAMES.viewer })).toHaveCount(0);
    await page.getByLabel("Search users").fill("nobody-by-that-name");
    await expect(page.getByText("No account matches that search or filter.")).toBeVisible();
    await page.getByLabel("Search users").fill("");
    await expect(first.filter({ hasText: USERNAMES.viewer })).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});
