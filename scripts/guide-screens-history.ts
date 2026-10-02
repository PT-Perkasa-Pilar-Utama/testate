/**
 * The third part of scripts/guide-screens.ts: comparing, checking out, the Activity tab, files,
 * jobs and the account screen. The checkout runs here, after every shot that needs the changed rows.
 */
import type { Page } from "@playwright/test";

import { WIDTH, fit, settle, shoot } from "./guide-marks.ts";

async function compare(page: Page, state: string): Promise<void> {
  await page.goto("/projects/demo?tab=states");
  await settle(page);
  await page.setViewportSize({ width: WIDTH, height: 900 });
  await page.getByRole("button", { name: "Compare" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("From").selectOption({ label: state });
  await dialog.getByLabel("To").selectOption({ label: "the live databases" });
  await shoot(
    page,
    "20-compare",
    [
      { at: dialog.getByLabel("From"), n: 1 },
      { at: dialog.getByLabel("To"), n: 2 },
      { at: dialog.getByRole("button", { name: "Compare", exact: true }), n: 3 },
    ],
    dialog
  );
  await dialog.getByRole("button", { name: "Compare", exact: true }).click();
  await page.goto("/projects/demo?tab=activity");
  await settle(page);
  await page.getByRole("tab", { name: "Diffs" }).click();
  const row = page.locator("main tr").filter({ hasText: state }).first();
  await row.getByText("Ready").waitFor({ timeout: 90_000 });
  await fit(page);
  await shoot(page, "21-diffs", [
    { at: page.getByRole("tab", { name: "Diffs" }), n: 1, side: "top" },
    { at: row.locator("td").first(), n: 2 },
    { at: row.getByText("Ready"), n: 3, side: "top" },
    { at: row.getByRole("link", { name: "Details" }), n: 4 },
  ]);
  await row.getByRole("link", { name: "Details" }).click();
  await settle(page);
  await page.locator("main").getByText("contract.customers").first().click();
  await settle(page);
  await fit(page);
  await shoot(page, "22-diff", [
    { at: page.locator("main").getByText("contract.customers").first().locator(".."), n: 1 },
    {
      at: page
        .getByRole("tab", { name: "Added" })
        .locator("..")
        .or(page.getByRole("button", { name: "Added" }).locator("..")),
      n: 2,
    },
    { at: page.locator("main tbody tr").first(), n: 3 },
  ]);
}

async function checkout(page: Page, state: string): Promise<void> {
  await page.goto("/projects/demo?tab=states");
  await settle(page);
  await page.getByRole("tab", { name: "List" }).click();
  await settle(page);
  const row = page.getByRole("list", { name: "States" }).locator("li").filter({ hasText: state });
  await page.setViewportSize({ width: WIDTH, height: 1000 });
  await row.getByRole("button", { name: "Check out" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByText("schema matches").first().waitFor({ timeout: 30_000 });
  await shoot(
    page,
    "23-checkout",
    [
      { at: dialog.getByText("A stash state is taken first."), n: 1 },
      { at: dialog.locator("table").first(), n: 2 },
      { at: dialog.getByText("Force past schema drift").locator(".."), n: 3 },
      { at: dialog.getByRole("button", { name: "Check out", exact: true }), n: 4 },
    ],
    dialog
  );
  await dialog.getByRole("button", { name: "Check out", exact: true }).click();
  await page.goto("/projects/demo?tab=activity");
  await settle(page);
  await page.getByRole("tab", { name: "Checkouts" }).click();
  await settle(page);
  const latest = page.locator("main tbody tr").first();
  await latest.getByText("Succeeded").waitFor({ timeout: 90_000 });
  await fit(page);
  await shoot(page, "24-checkouts", [
    { at: page.getByRole("tab", { name: "Checkouts" }), n: 1, side: "top" },
    { at: latest.locator("td").first(), n: 2 },
    { at: latest.getByText("Succeeded"), n: 3, side: "top" },
    {
      at: latest
        .getByRole("link", { name: "Details" })
        .or(latest.getByRole("button", { name: "Details" })),
      n: 4,
      side: "top",
    },
    { at: latest.getByRole("button", { name: "Counters" }), n: 5, side: "top" },
    { at: latest.getByRole("button", { name: "Retry" }), n: 6, side: "top" },
  ]);
}

async function stashes(page: Page): Promise<void> {
  await page.goto("/projects/demo?tab=states");
  await settle(page);
  await page.getByRole("tab", { name: "List" }).click();
  await page.getByText("Show stashes").click();
  await settle(page);
  await fit(page);
  const stash = page
    .getByRole("list", { name: "States" })
    .locator("li")
    .filter({ hasText: "Stash" })
    .first();
  await shoot(page, "25-stashes", [
    { at: page.getByText("Show stashes"), n: 1, side: "top" },
    { at: stash, n: 2 },
    { at: stash.getByRole("button", { name: "Check out" }), n: 3 },
  ]);
  await page.getByText("Show stashes").click();
}

async function files(page: Page, store: string): Promise<void> {
  await page.goto("/storage");
  await settle(page);
  await fit(page);
  await shoot(page, "26-storage", [
    { at: page.locator("main tr").filter({ hasText: "exports" }).last(), n: 1 },
  ]);
  await page.goto(`/projects/demo/adapters/${store}/files`);
  await settle(page);
  await page.locator("main").getByText("contract", { exact: true }).click();
  await settle(page);
  await fit(page);
  const file = page.locator("main tr").filter({ hasText: "readme.md" });
  await shoot(page, "27-files", [
    { at: page.getByLabel("Breadcrumb").or(page.locator("main nav").first()), n: 1 },
    { at: file.getByText("readme.md"), n: 2 },
    {
      at: file
        .getByRole("link", { name: "Download" })
        .or(file.getByRole("button", { name: "Download" })),
      n: 3,
    },
    { at: page.getByRole("button", { name: "Upload" }), n: 4, side: "bottom" },
  ]);
}

async function jobsAndAccount(page: Page): Promise<void> {
  await page.goto("/jobs");
  await settle(page);
  await fit(page, 760);
  const first = page.locator("main tbody tr").first();
  await shoot(page, "28-jobs", [
    { at: first.locator("td").first(), n: 1, side: "top" },
    { at: first.locator("td").nth(1), n: 2, side: "top" },
    { at: first.locator("td").nth(2), n: 3, side: "top" },
    { at: page.getByRole("button", { name: "Refresh" }), n: 4, side: "bottom" },
  ]);
  await page.goto("/account");
  await settle(page);
  await fit(page);
  await shoot(page, "29-account", [
    { at: page.getByLabel("Current password"), n: 1 },
    { at: page.getByLabel(/New password/), n: 2, side: "top" },
    { at: page.getByRole("button", { name: "Save password" }), n: 3 },
    { at: page.locator("main table").first(), n: 4 },
  ]);
}

export async function captureHistoryScreens(
  page: Page,
  state: string,
  store: string
): Promise<void> {
  await compare(page, state);
  await checkout(page, state);
  await stashes(page);
  await files(page, store);
  await jobsAndAccount(page);
}
