import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { demoAdapter, firstTable } from "./lib/api.ts";
import { openStatesList, openTab, settle } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

/**
 * Screenshots for the README, taken from the seeded demo project rather than drawn by hand, so a
 * screen that changes shows up as a diff on a PNG. Not part of a normal run: capture them with
 *
 *   SHOTS=1 bunx playwright test --project=screens
 */
const SHOTS = join(import.meta.dirname, "..", "docs", "assets", "screens");
const WIDTH = 1400;

/**
 * Trim the empty page below the content, so a short screen is not mostly white. The shell fills the
 * viewport, so measure what `main` holds instead, skipping the toast and anything else pinned.
 */
async function fit(page: Page): Promise<void> {
  const bottom = await page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll("main *")]
        .filter((node) => getComputedStyle(node).position !== "fixed")
        .map((node) => node.getBoundingClientRect().bottom)
    )
  );
  const height = Math.min(Math.max(Math.round(bottom) + 28, 360), 900);
  await page.setViewportSize({ width: WIDTH, height });
}

test.describe("README screens", () => {
  test.use({ storageState: statePath("qa"), viewport: { width: WIDTH, height: 780 } });
  test.skip(process.env["SHOTS"] !== "1", "set SHOTS=1 to write docs/assets/screens");

  test("captures one screen per capability", async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(SHOTS, { recursive: true });
    const postgres = await demoAdapter({ engine: "postgres" });
    const table = await firstTable(postgres.id);

    const shoot = async (path: string, name: string, tab?: string): Promise<void> => {
      await page.goto(path);
      await settle(page);
      await openTab(page, tab);
      await fit(page);
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    };

    await page.goto("/projects/demo");
    await settle(page);

    // Earlier specs name their states after themselves, so lead the list with two readable ones.
    // The list, not the tree: only a list row carries Check out, which is what "ready" means here.
    await openStatesList(page);
    const take = async (name: string, tags: string): Promise<void> => {
      await page.getByRole("button", { name: "Take state" }).click();
      const form = page.locator("dialog[open]");
      await form.getByLabel("Name").fill(name);
      await form.getByLabel("Tags (comma separated)").fill(tags);
      await form.getByRole("button", { name: "Take" }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      // A ready state prints no badge; it becomes checkout-able, and that is what to wait for.
      await expect(
        page
          .getByRole("list", { name: "States" })
          .locator("li")
          .filter({ hasText: name })
          .getByRole("button", { name: "Check out" })
      ).toBeEnabled({ timeout: 60_000 });
    };
    await take("checkout-flow-baseline", "release-2.4");
    await take("after-the-failed-refund", "bug-4182");

    // The demo has no diff of its own, so make one against the live database first: tick a state
    // on the States tab and compare it, which is where a diff starts now.
    await openStatesList(page);
    await page.getByRole("checkbox", { name: "Compare seeded-baseline" }).check();
    await page.getByRole("button", { name: "Compare with live" }).click();
    await expect(
      page.locator("tr", { hasText: "live database" }).first().getByText("ready")
    ).toBeVisible({ timeout: 90_000 });

    await shoot("/projects", "projects");
    await shoot("/projects/demo", "adapters", "Databases");
    await shoot("/projects/demo", "states", "States");
    // One shot, not three: checkouts, diffs and imports share the Activity tab now.
    await shoot("/projects/demo", "activity", "Activity");
    await page.getByRole("link", { name: "Details" }).first().click();
    await settle(page);
    await fit(page);
    await page.screenshot({ path: join(SHOTS, "diffs.png") });

    await shoot(
      `/projects/demo/adapters/${postgres.id}/tables/${encodeURIComponent(table)}`,
      "grid"
    );

    // An empty console shows nothing, so run a query and keep it before shooting.
    await page.goto(`/projects/demo/adapters/${postgres.id}/query`);
    await settle(page);
    await page.getByLabel("SQL").fill(`SELECT * FROM ${table} ORDER BY 1 LIMIT 5`);
    await page.getByRole("button", { name: "Run (read-only)" }).click();
    await expect(page.getByText("read-only transaction")).toBeVisible();
    await page.getByPlaceholder("save as...").fill("rows after a reset");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "rows after a reset" })).toBeVisible();
    await fit(page);
    await page.screenshot({ path: join(SHOTS, "query.png") });
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByRole("button", { name: "rows after a reset" })).toHaveCount(0);
  });
});
