import { expect, test } from "@playwright/test";

import { apiContext, demoAdapter, firstTable, insertRow } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import {
  readingById,
  sampleNow,
  serverKeys,
  serverValue,
  seriesPoints,
  startAndEndWriting,
  takeReading,
} from "./lib/monitor.ts";
import { statePath } from "./lib/roles.ts";

test.describe("who changed the data last", () => {
  test.use({ storageState: statePath("admin") });

  test("@story-164 a tester's write shows to someone else, with when, beside the write switch", async ({
    page,
  }) => {
    const issues: Issue[] = [];
    watch(page, issues);
    const mariadb = await demoAdapter({ engine: "mariadb" });
    const table = await firstTable(mariadb.id);
    // The tester writes; the admin, who did not, is the one warned. A caller never sees their own.
    const qa = await apiContext("qa");
    await startAndEndWriting(qa, mariadb.id);
    await qa.dispose();
    await page.goto(`/projects/demo/adapters/${mariadb.id}/tables/${encodeURIComponent(table)}`);
    await settle(page);
    await expect(page.getByRole("switch", { name: "Write mode" })).toBeVisible();
    // "qa-user started writing to shop-mariadb 3 seconds ago." or "... now."
    const line = new RegExp(`^qa-user started writing to ${mariadb.name} (now|.+ ago)\\.$`);
    await expect(page.getByText(line)).toBeVisible();
    expect(issues).toStrictEqual([]);
  });
});

test.describe("resource readings", () => {
  test.use({ storageState: statePath("qa") });

  // Compose has no SFTP host with a readable /proc, so the host half of a reading cannot be shown
  // here; the database server half is the same reading, compared the same way.
  test("@story-165 a reading before and after a run compares, and the server counted the run", async () => {
    test.setTimeout(90_000);
    const qa = await apiContext("qa");
    const postgres = await demoAdapter({ engine: "postgres" });
    const before = await takeReading(qa);
    await insertRow(qa, postgres.id, await firstTable(postgres.id));
    // Postgres publishes its counters a moment after a transaction, so take readings until it has.
    let after = await takeReading(qa);
    await expect
      .poll(
        async () => {
          after = await takeReading(qa);
          return serverValue(after, postgres.id, "commits");
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }
      )
      .toBeGreaterThan(serverValue(before, postgres.id, "commits"));
    // Both are kept and read back as they were taken, value for value, so the two line up.
    const stored = await readingById(qa, before.id);
    expect(serverKeys(stored, postgres.id)).toStrictEqual(serverKeys(after, postgres.id));
    expect(serverValue(stored, postgres.id, "commits")).toBe(
      serverValue(before, postgres.id, "commits")
    );
    expect(Date.parse(after.taken_at)).toBeGreaterThan(Date.parse(before.taken_at));
    await qa.dispose();
  });

  test("@story-166 samples twice and sees each database server drawn over time", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const issues: Issue[] = [];
    watch(page, issues);
    const postgres = await demoAdapter({ engine: "postgres" });
    await page.goto("/projects/demo?tab=monitor");
    await settle(page);
    expect(await sampleNow(page)).toBe(201);
    // A database server answers in well under a second: without the pause both readings fell in
    // one one-second bucket and the series held a single point.
    await page.waitForTimeout(1_100);
    expect(await sampleNow(page)).toBe(201);

    // The series buckets the samples; a second a bucket keeps the two apart.
    const qa = await apiContext("qa");
    expect(await seriesPoints(qa, postgres.id, "connections")).toBeGreaterThanOrEqual(2);
    await qa.dispose();

    // A graph per value under the server's name, with a line drawn through the samples.
    // The heading's own section: the tab panel around every server is a section too.
    const section = page
      .getByRole("heading", { name: new RegExp(`^${postgres.name}`) })
      .locator("xpath=..");
    await expect(section.getByText("database server", { exact: true })).toBeVisible();
    const chart = section.getByRole("img", { name: /^Connections, / });
    await expect(chart).toBeVisible();
    await expect(chart.locator("svg path").first()).toHaveAttribute("d", /^M/);

    // The Monitor menu lists the server across projects and leads back to the same graphs.
    await page.goto("/monitor");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Database servers" })).toBeVisible();
    await page.getByRole("link", { name: postgres.name, exact: true }).first().click();
    await expect(page).toHaveURL(/\/projects\/demo\?tab=monitor$/);
    expect(issues).toStrictEqual([]);
  });
});
