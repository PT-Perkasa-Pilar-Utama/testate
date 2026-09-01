import { expect, test } from "@playwright/test";

import { countApi, over, settle } from "./lib/crawl.ts";
import { SCREENS, statePath } from "./lib/roles.ts";
import { API_PORT } from "../playwright.config.ts";

/**
 * The built bundle, not Vite. Every other spec drives the dev server, and the two differ: a screen
 * that read a still-pending async memo outside its `<Loading>` loaded once under Vite and spun
 * forever in the bundle, ~250 requests a second, until the tab was closed. Two screens shipped that
 * way, so this walks all of them and counts.
 *
 * The API serves `apps/web/dist` itself, so the port is the API's and the cookie is the same one:
 * a session cookie is scoped to the host, not the port.
 */
const LIMIT = 3;
const IDLE_MS = 1_200;

test.describe("the production bundle", () => {
  test.use({ storageState: statePath("admin"), baseURL: `http://localhost:${API_PORT}` });

  test("asks each endpoint once per screen and then stops", async ({ page }) => {
    const counts = countApi(page);
    const spinning: string[] = [];
    for (const screen of SCREENS) {
      counts.clear();
      await page.goto(screen.path);
      await settle(page);
      await page.waitForTimeout(IDLE_MS);
      spinning.push(
        ...over(counts, LIMIT).map((hit) => `${screen.path}: ${hit.path} x${hit.count}`)
      );
    }
    expect(spinning).toStrictEqual([]);
  });
});
