import { expect, test } from "@playwright/test";

import { adapterScreens, demoAdapter, demoAdapters, firstTable } from "./lib/api.ts";
import { settle, watch } from "./lib/crawl.ts";
import type { Issue } from "./lib/crawl.ts";
import {
  PASSWORDS,
  ROLES,
  SCREENS,
  USERNAMES,
  allows,
  hiddenNavFor,
  navFor,
  outcomeOf,
  statePath,
} from "./lib/roles.ts";

const FORBIDDEN = "Your role cannot open this page.";

/** The six checks settings.health.view.tsx lists, in the order it lists them. */
const HEALTH_CHECKS = [
  "Metadata database",
  "Data directory",
  "Snapshot store",
  "Job dispatcher",
  "Log sink",
  "Sealed keys",
] as const;

/** Every role opens every top-level screen: allowed ones render, admin ones refuse below admin. */
for (const role of ROLES) {
  test.describe(`${role}: top-level screens`, () => {
    test.use({ storageState: statePath(role) });

    // SCREENS still lists "/health" (e2e/lib/roles.ts is out of this file's scope): the standalone
    // health page is deleted, so this loop skips that one entry instead of asserting a 404 route.
    // e2e/lib/roles.ts should drop the /health row from SCREENS itself, once that file is in scope.
    for (const screen of SCREENS) {
      test(`${screen.path} ${outcomeOf(role, screen.role)}`, async ({ page }) => {
        const issues: Issue[] = [];
        watch(page, issues);
        await page.goto(screen.path);
        await settle(page);
        const refused = await page.getByText(FORBIDDEN).isVisible();
        expect(refused).toBe(!allows(role, screen.role));
        // "Renders" used to mean only that the screen had not refused, which a screen stuck on
        // "Loading..." satisfies just as well. It has to say its own name.
        await expect(page.getByRole("heading", { name: screen.title }).first()).toBeVisible({
          visible: allows(role, screen.role),
        });
        expect(issues).toStrictEqual([]);
      });
    }

    test("@story-111 the tokens screen explains itself before any token exists", async ({
      page,
    }) => {
      test.skip(role !== "admin", "only an admin opens the tokens screen");
      await page.goto("/tokens");
      await settle(page);
      await expect(
        page.getByText("No tokens yet. Create one for CI, or for an agent that may only read.")
      ).toBeVisible();
    });

    test("@story-129 the health screen says in words what its badge means", async ({ page }) => {
      // The standalone /health page is gone; the report is the "Instance health" card inside the
      // admin-only /settings screen now (settings.health.view.tsx).
      test.skip(role !== "admin", "the health report now lives inside admin-only settings");
      const issues: Issue[] = [];
      watch(page, issues);
      await page.goto("/settings");
      await settle(page);
      await expect(page.getByRole("heading", { name: "Instance health" })).toBeVisible();
      const checklist = page.locator("dl");
      // Each check's status is spelled out next to its dot ("ok"/"degraded"/"down"), not just a
      // colour: that per-row word is what "says in words what its badge means" is asserting, and
      // it has to hold row by row, the way the old single sentence held only when every row did.
      for (const label of HEALTH_CHECKS) {
        await expect(checklist.locator("div").filter({ hasText: label })).toContainText("ok");
      }
      await page.getByRole("button", { name: "Refresh" }).click();
      await settle(page);
      await expect(checklist.locator("div").filter({ hasText: HEALTH_CHECKS[0] })).toContainText(
        "ok"
      );
      expect(issues).toStrictEqual([]);
    });

    test("@story-6 @story-9 the account screen is one click from the sidebar", async ({ page }) => {
      const issues: Issue[] = [];
      watch(page, issues);
      await page.goto("/projects");
      await settle(page);
      await page.getByRole("link", { name: new RegExp(`${role}$`) }).click();
      await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
      expect(issues).toStrictEqual([]);
    });

    test("@story-6 the sidebar lists only the screens the role may open", async ({ page }) => {
      await page.goto("/projects");
      await settle(page);
      const labels = await page.locator("nav a").allTextContents();
      const expected = navFor(role);
      expect(labels.map((l) => l.trim()).filter((l) => expected.includes(l))).toStrictEqual(
        expected
      );
      const hidden = hiddenNavFor(role);
      expect(labels.filter((l) => hidden.includes(l.trim()))).toStrictEqual([]);
    });
  });
}

/** The sign-in screen itself: what it says when it refuses, and where it sends you after. */
test.describe("signing in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("@story-1 refuses a wrong password in the app's own words, not the browser's", async ({
    page,
  }) => {
    await page.goto("/login");
    await settle(page);
    await page.getByLabel("Username").fill(USERNAMES.qa);
    await page.getByLabel("Password").fill("not-the-password");
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("@story-1 an empty sign-in refuses in the app's words, not the browser's bubble", async ({
    page,
  }) => {
    const bubbles: string[] = [];
    page.on("dialog", (dialog) => {
      bubbles.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto("/login");
    await settle(page);
    await page.locator('form button[type="submit"]').click();
    // Each message sits under the control it belongs to, rather than in one list at the top that
    // a person then has to match back to a box. Both fields are empty, so both say so.
    await expect(page.getByRole("alert")).toHaveText([
      "Enter your username.",
      "Enter your password.",
    ]);
    await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/login$/);
    expect(bubbles).toStrictEqual([]);
  });

  test("@story-6 sends you to the page you asked for, not the front page", async ({ page }) => {
    await page.goto("/jobs");
    await settle(page);
    await page.getByLabel("Username").fill(USERNAMES.qa);
    await page.getByLabel("Password").fill(PASSWORDS.qa);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
    await expect(page).toHaveURL(/\/jobs$/);
  });

  test("@story-6 reaches both fields and the button with the keyboard alone", async ({ page }) => {
    await page.goto("/login");
    await settle(page);
    await page.getByLabel("Username").focus();
    await expect(page.getByLabel("Username")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('form button[type="submit"]')).toBeFocused();
  });
});

/** Adapter sub-screens per role: the page renders and the role-gated controls match the role. */
for (const role of ROLES) {
  test.describe(`${role}: adapter screens`, () => {
    test.use({ storageState: statePath(role) });

    test("@story-12 @story-35 @story-94 @story-106 adapter, query, policies, grid, and files screens render", async ({
      page,
    }) => {
      const issues: Issue[] = [];
      watch(page, issues);
      const adapters = await demoAdapters();
      expect(adapters.length).toBeGreaterThan(0);
      for (const adapter of adapters) {
        const base = `/projects/demo/adapters/${adapter.id}`;
        await page.goto(base);
        await settle(page);
        await expect(page.getByRole("heading", { name: adapter.name })).toBeVisible();
        // `adapterScreens` (e2e/lib/api.ts, out of this file's scope) returns the policies path
        // for every tabular adapter regardless of role, but routes.ts now gates it to admin;
        // e2e/lib/api.ts should take the role and drop it itself, once that file is in scope.
        const paths = await adapterScreens(adapter, role);
        for (const path of paths) {
          await page.goto(path);
          await settle(page);
          // The crumb carries the adapter's own name; it used to be the literal word "adapter".
          await expect(page.getByRole("link", { name: adapter.name }).first()).toBeVisible();
        }
      }
      expect(issues).toStrictEqual([]);
    });

    test("@story-22 @story-40 write and delete controls follow the role", async ({ page }) => {
      const postgres = await demoAdapter({ engine: "postgres" });
      const base = `/projects/demo/adapters/${postgres.id}`;
      await page.goto(base);
      await settle(page);
      await expect(page.getByRole("button", { name: "Delete" })).toBeVisible({
        visible: allows(role, "qa"),
      });
      const table = await firstTable(postgres.id);
      await page.goto(`${base}/tables/${encodeURIComponent(table)}`);
      await settle(page);
      await expect(page.getByText("Write mode")).toBeVisible({ visible: allows(role, "qa") });
      // A project now opens on States; the adapter list lives at ?tab=adapters.
      await page.goto("/projects/demo?tab=adapters");
      await settle(page);
      await expect(page.getByRole("button", { name: "New adapter" })).toBeVisible({
        visible: allows(role, "qa"),
      });
    });
  });
}
