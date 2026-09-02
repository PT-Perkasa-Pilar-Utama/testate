import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { E2E_DIR } from "../playwright.config.ts";
import { adapterScreens, representativeAdapters } from "./lib/api.ts";
import { crawl, stuckDialogs, watch } from "./lib/crawl.ts";
import type { Click, Issue } from "./lib/crawl.ts";
import { ROLES, SCREENS, allows, statePath } from "./lib/roles.ts";

/**
 * The screens a role may open, top-level and one adapter per tier and mode; the crawler clicks
 * every control on each. Every engine's screens render in `routes.e2e.ts`; here they would only
 * be the same buttons again.
 */
async function screensFor(role: (typeof ROLES)[number]): Promise<string[]> {
  const paths = SCREENS.filter((s) => allows(role, s.role)).map((s) => s.path);
  for (const adapter of await representativeAdapters()) {
    paths.push(`/projects/demo/adapters/${adapter.id}`, ...(await adapterScreens(adapter, role)));
  }
  return paths;
}

for (const [seed, role] of ROLES.entries()) {
  test.describe(`${role}: every button on every screen`, () => {
    test.use({ storageState: statePath(role) });

    test("clicks each control, exercises each dialog, and sees no error", async ({ page }) => {
      test.setTimeout(15 * 60_000);
      const issues: Issue[] = [];
      watch(page, issues);
      const report: Record<string, Click[]> = {};
      for (const path of await screensFor(role)) report[path] = await crawl(page, path, seed + 1);
      mkdirSync(join(E2E_DIR, "crawl"), { recursive: true });
      writeFileSync(join(E2E_DIR, "crawl", `${role}.json`), JSON.stringify(report, null, 2));
      const clicked = Object.values(report).flat();
      expect(clicked.length).toBeGreaterThan(20);
      expect(stuckDialogs(clicked)).toStrictEqual([]);
      expect(issues).toStrictEqual([]);
    });
  });
}
