import { appendFileSync } from "node:fs";
import type { Locator, Page, Response } from "@playwright/test";

/** `E2E_NET=1` appends every API response body here, for a contract mismatch hunt. */
const NET_LOG = ".e2e/net.log";

export type Click = {
  label: string;
  dialog: string | null;
  landed: string;
  outcome: "closed" | "submitted" | "cancelled" | "navigated" | "no-op";
};

export type Issue = { kind: "pageerror" | "console" | "http5xx"; detail: string };

/**
 * Never clicked by the crawler: ends the session, or flips shared demo state with no dialog to
 * cancel (the flow specs cover those on data they create themselves).
 */
const SKIP = new Set([
  "Sign out",
  "Disable",
  "Enable",
  "Revoke",
  "Remove",
  "Delete",
  "Lock",
  "Unlock",
  "Make read-only",
  "Allow restores",
  "Retry",
  "Take state",
  "Check out",
  "Protect",
  "Unprotect",
]);
/** Dialogs whose submit destroys shared demo data: cancelled after the form is exercised. */
const DESTRUCTIVE = /delete|remove|reset|revoke|return to init/i;
const MAX_CLICKS = 60;
const CLICK_TIMEOUT = 3_000;
const SAMPLE = new Map([
  ["number", "1"],
  ["date", "2030-01-01"],
  ["password", "e2e-password-1234"],
]);

export function watch(page: Page, issues: Issue[]): void {
  page.on("pageerror", (error) => issues.push({ kind: "pageerror", detail: error.message }));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource/.test(text)) return;
    issues.push({ kind: "console", detail: text.slice(0, 300) });
  });
  page.on("response", (response) => {
    if (response.status() >= 500)
      issues.push({ kind: "http5xx", detail: `${response.status()} ${response.url()}` });
    if (process.env["E2E_NET"] === "1" && response.url().includes("/api/v1/"))
      void logResponse(response);
  });
}

async function logResponse(response: Response): Promise<void> {
  try {
    const body = await response.text();
    appendFileSync(NET_LOG, `${response.status()} ${response.url()}\n${body.slice(0, 1500)}\n\n`);
  } catch {
    // A body that is already gone is not worth an issue.
  }
}

/** DOM-settled: the loading placeholders are gone; no `networkidle` (Vite keeps a socket open). */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page
    .waitForFunction(() => !/Loading|Listing\.\.\./.test(document.body.innerText), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(80);
}

function interactive(page: Page): Locator {
  return page.locator("main button:visible, main a[href]:visible, main [role=tab]:visible");
}

/** Fills every empty required field with a plausible value so a submit reaches the API. */
async function fillRequired(dialog: Locator, seed: number): Promise<void> {
  const inputs = dialog.locator("input[required], textarea[required]");
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if ((await input.inputValue()) !== "") continue;
    const type = (await input.getAttribute("type")) ?? "text";
    await input.fill(SAMPLE.get(type) ?? `e2e${seed}${index}`);
  }
}

async function dialogTitle(dialog: Locator): Promise<string> {
  try {
    return ((await dialog.locator("h2, h1").first().textContent()) ?? "").trim();
  } catch {
    return "";
  }
}

/** A dialog that opened and was neither submitted, cancelled, nor closed: the crawler got stuck. */
export function stuckDialogs(clicks: Click[]): Click[] {
  return clicks.filter((c) => c.dialog !== null && c.outcome === "no-op");
}

async function handleDialog(page: Page, dialog: Locator, seed: number): Promise<Click["outcome"]> {
  const title = await dialogTitle(dialog);
  const destructive = DESTRUCTIVE.test(title) || DESTRUCTIVE.test(await dialog.innerText());
  await fillRequired(dialog, seed);
  if (!destructive) {
    const submit = dialog.locator('button[type="submit"]').first();
    if ((await submit.count()) > 0) {
      await submit.click({ timeout: CLICK_TIMEOUT }).catch(() => undefined);
      await settle(page);
      if (!(await dialog.isVisible().catch(() => false))) return "submitted";
    }
  }
  const cancel = dialog.locator("button:visible", { hasText: /^(Cancel|Close|Done)$/ }).first();
  if ((await cancel.count()) > 0) {
    await cancel.click({ timeout: CLICK_TIMEOUT }).catch(() => page.keyboard.press("Escape"));
  } else await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  return destructive ? "cancelled" : "closed";
}

/**
 * Clicks every visible control on a screen once, fresh from the route each time: a dialog gets
 * its required fields filled and is submitted (destructive ones are cancelled), a navigation is
 * recorded, and the page is checked for errors throughout.
 */
export async function crawl(page: Page, path: string, seed: number): Promise<Click[]> {
  await page.goto(path);
  await settle(page);
  const total = Math.min(await interactive(page).count(), MAX_CLICKS);
  const clicks: Click[] = [];
  const at = (): string => page.url().replace(/^https?:\/\/[^/]+/, "");
  for (let index = 0; index < total; index += 1) {
    // Reload only when the last click left the screen or changed it: most clicks are cheap toggles.
    if (at() !== path) {
      await page.goto(path);
      await settle(page);
    }
    const control = interactive(page).nth(index);
    if ((await control.count()) === 0) break;
    const label = ((await control.textContent()) ?? "").trim().slice(0, 40);
    if (SKIP.has(label) || (await control.isDisabled())) continue;
    await control.click({ timeout: CLICK_TIMEOUT }).catch(() => undefined);
    await settle(page);
    const result = await afterClick(page, path, seed * 100 + index);
    clicks.push({ label, ...result, landed: at() });
  }
  return clicks;
}

/** What the click did: opened a dialog (handled here), navigated, or nothing visible. */
async function afterClick(
  page: Page,
  path: string,
  seed: number
): Promise<Pick<Click, "dialog" | "outcome">> {
  const dialog = page.locator("dialog[open]").first();
  if (await dialog.isVisible().catch(() => false)) {
    const title = await dialogTitle(dialog);
    const outcome = await handleDialog(page, dialog, seed);
    if (outcome === "submitted") await page.goto(path);
    return { dialog: title, outcome };
  }
  const here = page.url().replace(/^https?:\/\/[^/]+/, "");
  return { dialog: null, outcome: here === path ? "no-op" : "navigated" };
}
