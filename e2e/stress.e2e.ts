import { expect, test } from "@playwright/test";

import { firstTableOf } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

/**
 * A hunt, not a story. Solid's "Potential Infinite Loop Detected" has fired three times in about
 * ten full runs, on the data grid, and never in a crawl run on its own. The crawler settles after
 * every click; this does not, because the shape being chased is an async memo invalidated while
 * its previous promise is still resolving.
 *
 *   STRESS=1 bunx playwright test --project=stress
 */
const ROUNDS = 20;

test.describe("the grid under a hand that never waits", () => {
  test.use({ storageState: statePath("qa") });
  test.skip(process.env["STRESS"] !== "1", "set STRESS=1 to hunt the reactive loop");

  test("survives sorting, filtering and paging with no pause between clicks", async ({ page }) => {
    test.setTimeout(300_000);
    const issues: Issue[] = [];
    watch(page, issues);
    // The crawler passes through the jobs screen before it reaches the grid, and that screen opens
    // a live stream per running job. Walk the same path.
    await page.goto("/jobs");
    await settle(page);
    await page.goto("/projects/demo");
    await settle(page);
    const mongo = await firstTableOf("mongodb");
    await page.goto(
      `/projects/demo/adapters/${mongo.id}/tables/${encodeURIComponent(mongo.table)}`
    );
    await settle(page);

    // The frames say the write-back of a *rejected* async memo is where it spins, and the grid is
    // the only screen whose refreshable takes a query a person can make invalid.
    await page.getByLabel("Filter column").selectOption({ index: 0 });
    await page.getByLabel("Filter value").fill("not-a-number-at-all");
    await page.getByRole("button", { name: "Add filter" }).click();
    for (let round = 0; round < ROUNDS; round += 1) {
      await page
        .locator("main thead button")
        .first()
        .click({ timeout: 500 })
        .catch(() => undefined);
      await page
        .locator("main thead button")
        .last()
        .click({ timeout: 500 })
        .catch(() => undefined);
      await page
        .getByLabel("Filter value")
        .fill(`x${round}`)
        .catch(() => undefined);
      await page
        .getByRole("button", { name: "Add filter" })
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      // A control that is gone or disabled at this instant is not the point: the point is that
      // nothing settles between one click and the next.
      const optional = { timeout: 500 };
      await page
        .getByRole("button", { name: "Remove filter" })
        .click(optional)
        .catch(() => undefined);
      await page
        .getByRole("button", { name: "Next" })
        .click(optional)
        .catch(() => undefined);
      await page
        .getByRole("switch", { name: "Write mode" })
        .click(optional)
        .catch(() => undefined);
      // The two things the crawler does here that the first version of this spec did not: the
      // fixture dialog and the row form, both of which mount their own async reads over the grid.
      await page
        .getByRole("button", { name: "Fixture" })
        .first()
        .click(optional)
        .catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
      await page
        .getByRole("button", { name: "Insert row" })
        .click(optional)
        .catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
      await page
        .getByRole("switch", { name: "Write mode" })
        .click(optional)
        .catch(() => undefined);
    }

    await settle(page);
    expect(issues).toStrictEqual([]);
  });
});
