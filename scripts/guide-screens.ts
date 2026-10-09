/**
 * Captures the screenshots in docs/user-guide/images from a seeded demo, signed in as a Tester,
 * with numbered callouts drawn over the controls the guide talks about.
 *
 *   bun run seed:dev                     # or seed a spare instance: bun run seed:dev <url>
 *   GUIDE_ADMIN_PASSWORD=... bun scripts/guide-screens.ts [base-url]
 *
 * It changes the instance it runs against: it adds demo customers, takes a state, inserts a row,
 * imports a file, compares, and checks out. Run it against a freshly seeded instance you do not mind
 * changing.
 * The admin password is only for the first sign-in shot: it creates a throwaway Tester account
 * with a temporary password. The guide's text names every number, so a moved control means
 * re-reading the guide after a re-run, not only the pictures.
 */
import { chromium, request } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

import { addDemoCustomers, captureDataScreens } from "./guide-screens-data.ts";
import { WIDTH, fit, settle, shoot } from "./guide-marks.ts";

const BASE = (process.argv[2] ?? "http://localhost:7379").replace(/\/$/, "");
const TESTER = Bun.env["GUIDE_USER"] ?? "qa-user";
const TESTER_PASSWORD = Bun.env["GUIDE_PASSWORD"] ?? "qa-final-password-1";
const ADMIN_PASSWORD = Bun.env["GUIDE_ADMIN_PASSWORD"] ?? "";
const STATE = "before-payment-test";

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE,
    colorScheme: "light",
    viewport: { width: WIDTH, height: 820 },
  });
  return await context.newPage();
}

async function signIn(page: Page, user: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(user);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await settle(page);
}

/** A Tester account with a temporary password, made over the API the way an admin would. */
async function temporaryTester(): Promise<{ user: string; password: string }> {
  const api = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Testate-Request": "1" },
  });
  const login = await api.post("/api/v1/auth/login", {
    data: { username: "admin", password: ADMIN_PASSWORD },
  });
  if (!login.ok()) throw new Error(`admin sign-in answered ${login.status()}`);
  const user = `dina.${Date.now().toString(36)}`;
  const password = "Temporary-pass-2026";
  const made = await api.post("/api/v1/users", {
    data: {
      username: user,
      display_name: "Dina Putri",
      role: "qa",
      temporary_password: password,
      project_ids: null,
    },
  });
  if (!made.ok()) throw new Error(`creating ${user} answered ${made.status()}`);
  await api.dispose();
  return { user, password };
}

async function firstSignIn(browser: Browser): Promise<void> {
  if (ADMIN_PASSWORD === "") {
    process.stdout.write("  skipped the first sign-in shots: GUIDE_ADMIN_PASSWORD is not set\n");
    return;
  }
  const account = await temporaryTester();
  const page = await newPage(browser);
  await page.setViewportSize({ width: WIDTH, height: 640 });
  await page.goto("/login");
  await settle(page);
  await page.getByLabel("Username").fill(account.user);
  await page.getByLabel("Password").fill(account.password);
  const card = page.locator("form").first();
  await shoot(
    page,
    "01-sign-in",
    [
      { at: page.getByLabel("Username"), n: 1 },
      { at: page.getByLabel("Password"), n: 2 },
      { at: page.getByRole("button", { name: "Sign in" }), n: 3 },
    ],
    card.locator("xpath=ancestor::section[1]")
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Choose a new password").waitFor();
  await page.getByLabel("Current password").fill(account.password);
  await page.getByLabel("New password").fill("a-new-password-of-my-own");
  await shoot(
    page,
    "02-new-password",
    [
      { at: page.getByLabel("Current password"), n: 1 },
      { at: page.getByLabel("New password"), n: 2 },
      { at: page.getByRole("button", { name: "Save password" }), n: 3 },
    ],
    page.locator("section").filter({ hasText: "Choose a new password" }).last()
  );
  await page.context().close();
}

async function home(page: Page): Promise<void> {
  await page.goto("/");
  await settle(page);
  await fit(page);
  const card = (title: string) =>
    page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::section[1]");
  await shoot(page, "03-home", [
    { at: page.locator("aside nav"), n: 1 },
    { at: card("Projects"), n: 2 },
    { at: card("Running now"), n: 3 },
    { at: card("Needs attention"), n: 4 },
    { at: page.getByRole("button", { name: /account and sign out/ }), n: 5 },
  ]);
  await page.getByRole("button", { name: /account and sign out/ }).click();
  const menu = page.locator(":popover-open");
  await shoot(page, "04-account-menu", [
    { at: menu.getByRole("link", { name: "Account" }), n: 1 },
    { at: menu.getByText(/^Theme:/), n: 2 },
    { at: menu.getByText("Sign out", { exact: true }), n: 3 },
  ]);
  await page.keyboard.press("Escape");
}

async function projects(page: Page): Promise<void> {
  await page.goto("/projects");
  await settle(page);
  await fit(page);
  await shoot(page, "05-projects", [
    { at: page.getByRole("link", { name: "Demo" }), n: 1 },
    { at: page.getByRole("button", { name: "Filters" }), n: 2, side: "bottom" },
    { at: page.getByRole("button", { name: "New project" }), n: 3, side: "bottom" },
  ]);
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Name").fill("Payment service SIT");
  await dialog.getByLabel("Description").fill("Test data for the payment service in SIT");
  await shoot(
    page,
    "06-new-project",
    [
      { at: dialog.getByLabel("Name"), n: 1 },
      { at: dialog.getByLabel("Description"), n: 2 },
      { at: dialog.getByLabel("URL"), n: 3 },
      { at: dialog.getByRole("button", { name: "Create" }), n: 4, side: "top" },
    ],
    dialog
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: "Discard" })
    .click({ timeout: 2000 })
    .catch(() => undefined);
}

async function projectPage(page: Page): Promise<void> {
  await page.goto("/projects/demo");
  await settle(page);
  await page.getByRole("tab", { name: "Tree" }).click();
  await settle(page);
  await fit(page);
  const head = page.locator("main").getByText("HEAD", { exact: true }).first();
  await shoot(page, "07-project", [
    { at: page.getByRole("button", { name: "Snapshot" }), n: 1 },
    { at: head.locator(".."), n: 2 },
    { at: page.getByRole("tablist").first(), n: 3 },
    { at: page.getByRole("tab", { name: "Tree" }).locator(".."), n: 4 },
    { at: page.getByRole("button", { name: "Check out" }).first(), n: 5 },
    { at: page.getByText("Show stashes").locator(".."), n: 6, side: "top" },
    { at: page.getByRole("button", { name: "Compare" }), n: 7, side: "top" },
  ]);
}

async function snapshot(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Snapshot" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Name").fill(STATE);
  await dialog.getByLabel("Notes").fill("Clean data before the payment regression run.");
  await dialog.getByLabel(/^Tags/).fill("sprint-12");
  await shoot(
    page,
    "08-snapshot",
    [
      { at: dialog.getByLabel("Name"), n: 1 },
      { at: dialog.getByLabel("Notes"), n: 2 },
      { at: dialog.getByLabel(/^Tags/), n: 3 },
      { at: dialog.getByText("In the frame").locator(".."), n: 4 },
      { at: dialog.getByRole("button", { name: "Take" }), n: 5, side: "top" },
    ],
    dialog
  );
  await dialog.getByRole("button", { name: "Take" }).click();
  await page.getByRole("tab", { name: "List" }).click();
  await page
    .getByRole("list", { name: "States" })
    .locator("li")
    .filter({ hasText: STATE })
    .getByRole("button", { name: "Check out" })
    .waitFor({ timeout: 60_000 });
  await settle(page);
  const row = page.getByRole("list", { name: "States" }).locator("li").filter({ hasText: STATE });
  await fit(page);
  await shoot(page, "09-states-list", [
    { at: row.getByRole("link", { name: STATE }), n: 1 },
    { at: row.getByText("HEAD", { exact: true }), n: 2, side: "top" },
    { at: row.getByText("sprint-12"), n: 3, side: "top" },
    { at: row.getByRole("button", { name: "Check out" }), n: 4 },
    { at: row.locator("button[aria-haspopup=menu]"), n: 5, side: "top" },
  ]);
}

async function statePage(page: Page): Promise<void> {
  await page.getByRole("link", { name: STATE }).first().click();
  await settle(page);
  await fit(page);
  const button = (name: string) => page.locator("main").getByRole("button", { name, exact: true });
  await shoot(page, "10-state", [
    { at: button("Check out"), n: 1, side: "bottom" },
    { at: button("Compare with live"), n: 2, side: "bottom" },
    {
      at: page.locator("main").getByRole("link", { name: "Download" }).or(button("Download")),
      n: 3,
      side: "bottom",
    },
    { at: button("Edit"), n: 4, side: "bottom" },
    { at: button("Protect"), n: 5, side: "bottom" },
    { at: button("Delete"), n: 6, side: "bottom" },
    { at: page.locator("main table").first(), n: 7 },
  ]);
}

const browser = await chromium.launch();
try {
  process.stdout.write(`capturing from ${BASE}\n`);
  await firstSignIn(browser);
  const page = await newPage(browser);
  await signIn(page, TESTER, TESTER_PASSWORD);
  await home(page);
  await addDemoCustomers(page);
  await projects(page);
  await projectPage(page);
  await snapshot(page);
  await statePage(page);
  await captureDataScreens(page, STATE);
} finally {
  await browser.close();
}
