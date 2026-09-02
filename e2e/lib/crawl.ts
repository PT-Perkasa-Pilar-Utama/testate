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
  "Repair counters",
  "New import",
  "Migrate store",
  "Edit adapter",
  "Run backup",
  "Re-import rejected",
  "Move up",
  "Move down",
  "Abort on failure",
  "Continue on failure",
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
  // The page it happened on, because the crawler visits thirty of them and the message alone
  // ("Potential Infinite Loop Detected") says nothing about where to look.
  const where = (): string => new URL(page.url()).pathname;
  page.on("pageerror", (error) =>
    issues.push({
      kind: "pageerror",
      // The stack too: the message alone has twice sent a reader to the wrong module.
      detail: `${where()} ${error.message}\n${(error.stack ?? "").split("\n").slice(1, 6).join("\n")}`,
    })
  );
  page.on("console", (message) => {
    const text = message.text();
    // Solid's dev build reports its reactivity diagnostics as warnings with a stable code, and we
    // were dropping every warning, so the codes that name our own mistakes never reached a run.
    const diagnostic = message.type() === "warning" && /\[[A-Z_]{6,}\]/.test(text);
    if (message.type() !== "error" && !diagnostic) return;
    if (/Failed to load resource/.test(text)) return;
    // The location too, for a diagnostic: the code names the mistake and the file names the line.
    const at = message.location();
    const site = at.url === "" ? "" : ` (${at.url.split("/").slice(-1)[0]}:${at.lineNumber})`;
    issues.push({ kind: "console", detail: `${where()} ${text.slice(0, 300)}${site}` });
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

export type Refetch = { path: string; count: number };

/**
 * Counts what the page asks the API for, live. A screen asks each endpoint once; a screen that
 * reads a still-pending async memo outside its `<Loading>` re-runs to wait for it, rebuilds its
 * presenter, and asks again, forever, at one request per round trip.
 */
export function countApi(page: Page): Map<string, number> {
  const counts = new Map<string, number>();
  page.on("request", (request) => {
    const tail = request.url().split("/api/v1/")[1];
    if (tail === undefined) return;
    // Without the query a paged endpoint counts as one endpoint, so a loop over it still shows.
    const path = tail.split("?")[0] ?? tail;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  });
  return counts;
}

/** The endpoints asked for more than `limit` times, worst first. */
export function over(counts: Map<string, number>, limit: number): Refetch[] {
  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .filter((entry) => entry.count > limit)
    .sort((left, right) => right.count - left.count);
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
  // `CRAWL_LOG=1` prints one line per click with the seconds it cost, which is how a crawl that
  // used to take a minute and now takes fifteen says where the time went.
  const started = Date.now();
  const log = (line: string): void => {
    if (process.env["CRAWL_LOG"] === "1") process.stdout.write(`crawl ${path} ${line}\n`);
  };
  log(`${total} controls`);
  for (let index = 0; index < total; index += 1) {
    // Reload only when the last click left the screen or changed it: most clicks are cheap toggles.
    if (at() !== path) {
      await page.goto(path);
      await settle(page);
    }
    const control = interactive(page).nth(index);
    if ((await control.count()) === 0) break;
    // Every read gets the same deadline as the click. A screen that falls into its error boundary
    // between two of these calls leaves the locator waiting for an element that is never coming
    // back, and an untimed read then burns the whole test's budget instead of one step's.
    const label = ((await control.textContent({ timeout: CLICK_TIMEOUT }).catch(() => null)) ?? "")
      .trim()
      .slice(0, 40);
    const disabled = await control.isDisabled({ timeout: CLICK_TIMEOUT }).catch(() => true);
    if (SKIP.has(label) || disabled) continue;
    await control.click({ timeout: CLICK_TIMEOUT }).catch(() => undefined);
    await settle(page);
    const result = await afterClick(page, path, seed * 100 + index);
    clicks.push({ label, ...result, landed: at() });
    log(`#${index} "${label}" ${result.outcome} ${Math.round((Date.now() - started) / 1000)}s`);
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

/** Opens a project tab when one is named, then waits for the screen to settle. */
/**
 * Opens a row's overflow menu and answers with the row, so a spec can reach the actions that no
 * longer sit in the row itself.
 *
 * Addressed by `aria-haspopup`, not by a label: the trigger's name is "More actions" in a table
 * and whatever the screen sets everywhere else. The panel renders in the top layer but stays a
 * child of the row in the DOM, so the row is still the right thing to hand back.
 */
export async function rowMenu(row: Locator): Promise<Locator> {
  await row.locator("button[aria-haspopup=menu]").first().click();
  return row;
}

/**
 * Opens a project's States tab on the list, not the tree.
 *
 * Tree is the default since the rework, and it is a history: a row links to the state and carries
 * no actions, because an action on a node of a graph reads as an action on the branch. Every spec
 * that checks a state out, renames one, or protects one wants the list.
 */
export async function openStatesList(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "States" }).click();
  await page.getByRole("tab", { name: "List" }).click();
  await settle(page);
}

/**
 * One entry in the states timeline, which replaced the states table. The list carries an
 * accessible name so a spec addresses an entry without guessing at markup.
 */
export function stateRow(page: Page, name: string): Locator {
  return page.getByRole("list", { name: "States" }).locator("li").filter({ hasText: name });
}

/** The rows holding data. The empty state is a row as well, and counting it hides an empty table. */
export function dataRows(page: Page): Locator {
  return page.locator("main tbody tr:not(:has(td[colspan]))");
}

export async function openTab(page: Page, tab: string | undefined): Promise<void> {
  if (tab !== undefined) await page.getByRole("tab", { name: tab }).click();
  await settle(page);
}

/**
 * Cards whose content is wider than the card.
 *
 * A grid or flex item will not shrink below its own content unless told it may, so one long
 * unbroken string (a hash, a base64 blob, a uuid) makes a row wider than the card holding it and
 * that row is then drawn over whatever sits beside it. Nothing else in the suite notices: every
 * control is still present and still clickable, just underneath something else.
 */
export async function overflowingCards(page: Page): Promise<string[]> {
  return await page.locator("main section.rounded-lg").evaluateAll((nodes) =>
    nodes
      .map((node, index) => ({ index, over: node.scrollWidth - node.clientWidth }))
      // One pixel of rounding is not a spill; a hash overhanging its card is tens of them.
      .filter((card) => card.over > 1)
      .map((card) => `card ${card.index} overflows by ${card.over}px`)
  );
}

/** A control's distance from the top of the page, so a spec can compare two without a branch. */
export async function topOf(target: Locator): Promise<number> {
  const box = await target.boundingBox();
  return box === null ? Number.NaN : box.y;
}

/** How many cards a screen is showing. An overflow check over zero cards proves nothing. */
export async function cardCount(page: Page): Promise<number> {
  return await page.locator("main section.rounded-lg").count();
}
