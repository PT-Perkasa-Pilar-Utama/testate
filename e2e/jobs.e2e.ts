import { expect, test } from "@playwright/test";

import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import { statePath } from "./lib/roles.ts";

/**
 * The jobs screen: what a long operation looks like, and that Cancel is offered only while there
 * is something to cancel.
 *
 * These two stories lived in `hooks.e2e.ts` for no reason but that the file existed. Hooks were
 * removed in the beta rework and the file went with them, taking two unrelated stories' coverage
 * with it. This is their own home.
 *
 * It runs in the `flows` project, after `routes`, so the specs before it have left finished jobs
 * behind. Nothing here starts a job: a test that raced a real snapshot would either sleep or
 * branch, and a branching test is one that can quietly assert nothing.
 */
test.describe("jobs", () => {
  test.use({ storageState: statePath("qa") });

  test("@story-104 @story-105 the list shows a job's kind and status, and offers cancel only while it can still be stopped", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    await page.goto("/jobs");
    await settle(page);
    await expect(page.locator("main tbody tr").first()).toBeVisible();
    const finished = page.locator("main tbody tr", { hasText: "succeeded" }).first();
    await expect(finished).toBeVisible();
    // A snapshot, a checkout, an import: whichever ran first, the row says which kind it was.
    await expect(finished).toContainText(/snapshot|checkout|import|diff/i);
    // The one deterministic half of cancel: a job that already succeeded cannot be stopped, so the
    // control must not be there to press.
    await expect(finished.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    expect(issues).toStrictEqual([]);
  });
});
