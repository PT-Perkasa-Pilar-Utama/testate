import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { adapterScreens, apiContext, demoAdapters } from "./lib/api.ts";
import { countApi, over, settle } from "./lib/crawl.ts";
import { SCREENS, statePath } from "./lib/roles.ts";
import { API_PORT } from "../playwright.config.ts";

/**
 * The built bundle, not Vite. Every other spec drives the dev server, and the two differ: a screen
 * that read a still-pending async memo outside its `<Loading>` loaded once under Vite and spun
 * forever in the bundle, ~250 requests a second, until the tab was closed. Two screens shipped that
 * way, so this walks all of them and counts.
 *
 * `SCREENS` alone is the top nav, and both incidents were on screens it lists. Everything behind
 * an id was uncovered: an adapter's own tabs, a file store's files, a diff. Those are discovered
 * from the API here, because their paths carry ids no fixed list can hold.
 *
 * The API serves `apps/web/dist` itself, so the port is the API's and the cookie is the same one:
 * a session cookie is scoped to the host, not the port.
 */
const LIMIT = 3;
const IDLE_MS = 1_200;

/** Every screen behind an id, found the way a person finds them: from what the instance holds. */
async function deepPaths(): Promise<string[]> {
  const paths = ["/", "/storage"];
  for (const adapter of await demoAdapters("admin")) {
    const base = `/projects/demo/adapters/${adapter.id}`;
    paths.push(base, ...(await adapterScreens(adapter, "admin")));
    if (adapter.tier === "tabular") paths.push(`${base}/imports`, `${base}/masks`);
  }
  const context = await apiContext("admin");
  const response = await context.get("projects/demo/diffs");
  const body: { data: { id: string }[] } = await response.json();
  await context.dispose();
  paths.push(...body.data.slice(0, 1).map((diff) => `/projects/demo/diffs/${diff.id}`));
  return paths;
}

/**
 * Loads one screen with an empty counter and reports what is wrong with it: an endpoint it will
 * not stop asking, or a screen that threw instead of drawing.
 *
 * Counting alone is not enough. An unguarded read of a pending value throws past the screen, and
 * the root `<Errored>` in `app.tsx` answers that with the crash banner over the whole main area.
 * That screen asks for nothing at all, so a counter calls it the quietest one in the suite.
 */
async function faultsOn(page: Page, counts: Map<string, number>, path: string): Promise<string[]> {
  counts.clear();
  await page.goto(path);
  await settle(page);
  await page.waitForTimeout(IDLE_MS);
  const crashed = await page.getByText("This screen stopped working.").count();
  const faults = over(counts, LIMIT).map((hit) => `${path}: ${hit.path} x${hit.count}`);
  return crashed > 0 ? [...faults, `${path}: crashed`] : faults;
}

test.describe("the production bundle", () => {
  test.use({ storageState: statePath("admin"), baseURL: `http://localhost:${API_PORT}` });

  test("asks each endpoint once per screen and then stops", async ({ page }) => {
    const counts = countApi(page);
    const faults: string[] = [];
    for (const screen of SCREENS) faults.push(...(await faultsOn(page, counts, screen.path)));
    expect(faults).toStrictEqual([]);
  });

  test("a screen behind an id settles too, including a file store's own tab", async ({ page }) => {
    const counts = countApi(page);
    const paths = await deepPaths();
    // A seed with no adapters, or none holding files, would make this pass by walking nothing.
    expect(paths.length).toBeGreaterThan(4);
    expect(paths.filter((path) => path.endsWith("/files"))).not.toStrictEqual([]);
    const faults: string[] = [];
    for (const path of paths) faults.push(...(await faultsOn(page, counts, path)));
    expect(faults).toStrictEqual([]);
  });
});
