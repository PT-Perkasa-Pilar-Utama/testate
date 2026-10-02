/**
 * Numbered callouts for the user-guide screenshots (scripts/guide-screens.ts): an orange box around
 * each control and a numbered disc on its corner, drawn into the page before the shot and removed
 * after it. Orange, because the app's own accent is teal and a marker must never read as the UI.
 */
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

/** Where the number sits: beside the box on the left by default, or above, below, or right of it. */
export type Side = "left" | "top" | "bottom" | "right";
export type Mark = { at: Locator; n: number; side?: Side };
type Rect = { x: number; y: number; width: number; height: number };
/** The top-left corner of a numbered disc, in viewport pixels. */
type Disc = { dx: number; dy: number };
type Box = Rect & Disc & { n: number };

const PAD = 4;
const DISC = 26;
const GAP = 6;

/** The disc's top-left corner. A left disc with no room on the left goes above instead. */
function discAt(box: Rect, side: Side): Disc {
  const middleX = box.x + box.width / 2 - DISC / 2;
  const middleY = box.y + box.height / 2 - DISC / 2;
  const left = box.x - PAD - GAP - DISC;
  if (side === "left" && left >= 2) return { dx: left, dy: middleY };
  if (side === "right") return { dx: box.x + box.width + PAD + GAP, dy: middleY };
  if (side === "bottom") return { dx: middleX, dy: box.y + box.height + PAD + GAP };
  return { dx: middleX, dy: Math.max(box.y - PAD - GAP - DISC, 2) };
}

export const WIDTH = 1280;
const IMAGES = join(import.meta.dirname, "..", "docs", "user-guide", "images");

async function boxOf(mark: Mark): Promise<Box> {
  const box = await mark.at.first().boundingBox({ timeout: 5000 });
  if (box === null) throw new Error(`mark ${mark.n} is not on the screen`);
  return { ...box, n: mark.n, ...discAt(box, mark.side ?? "left") };
}

/**
 * A dialog and a menu render in the top layer, above any z-index on the page, so a marker drawn
 * into `body` would sit under them. The markers go into the topmost layer that is open instead.
 */
async function draw(page: Page, boxes: Box[]): Promise<void> {
  await page.evaluate((list) => {
    const host =
      document.querySelector(":popover-open") ??
      document.querySelector("dialog[open]") ??
      document.body;
    const PAD = 4;
    // Toasts float over the content and say something only for the moment they appear.
    for (const node of document.querySelectorAll<HTMLElement>("[aria-live]")) {
      if (getComputedStyle(node).position === "fixed") node.classList.add("guide-hidden");
    }
    const style = document.createElement("style");
    style.className = "guide-mark";
    style.textContent = ".guide-hidden{visibility:hidden!important}";
    document.head.append(style);
    for (const box of list) {
      const frame = document.createElement("div");
      frame.className = "guide-mark";
      frame.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${box.x - PAD}px;top:${box.y - PAD}px;width:${box.width + PAD * 2}px;height:${box.height + PAD * 2}px;border:2.5px solid #f2600c;border-radius:8px;box-shadow:0 0 0 2px rgba(255,255,255,.85)`;
      const disc = document.createElement("div");
      disc.className = "guide-mark";
      disc.textContent = String(box.n);
      disc.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${box.dx}px;top:${box.dy}px;width:26px;height:26px;border-radius:50%;background:#f2600c;color:#fff;font:700 14px/26px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2.5px #fff,0 2px 6px rgba(0,0,0,.35)`;
      host.append(frame, disc);
    }
  }, boxes);
}

export async function clearMarks(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll(".guide-mark")) node.remove();
    for (const node of document.querySelectorAll(".guide-hidden"))
      node.classList.remove("guide-hidden");
  });
}

/** Grows or shrinks the viewport to what `main` holds, so a short screen is not mostly blank. */
export async function fit(page: Page, max = 1100): Promise<void> {
  const bottom = await page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll("main *")]
        .filter((node) => getComputedStyle(node).position !== "fixed")
        .map((node) => node.getBoundingClientRect().bottom)
    )
  );
  await page.setViewportSize({
    width: WIDTH,
    height: Math.min(Math.max(Math.round(bottom) + 32, 560), max),
  });
}

/**
 * Draws the marks, takes the shot, and clears them. `clip` crops to one element (a dialog, a
 * card) plus a margin wide enough for the discs that hang off its corners.
 */
export async function shoot(
  page: Page,
  name: string,
  marks: readonly Mark[],
  clip?: Locator
): Promise<void> {
  await page.waitForTimeout(250);
  await draw(page, await Promise.all(marks.map((mark) => boxOf(mark))));
  const area = clip === undefined ? null : await clip.first().boundingBox();
  const size = page.viewportSize() ?? { width: WIDTH, height: 900 };
  const MARGIN = 44;
  const options =
    area === null
      ? {}
      : {
          clip: {
            x: Math.max(area.x - MARGIN, 0),
            y: Math.max(area.y - MARGIN, 0),
            width: Math.min(area.width + MARGIN * 2, size.width - Math.max(area.x - MARGIN, 0)),
            height: Math.min(area.height + MARGIN * 2, size.height - Math.max(area.y - MARGIN, 0)),
          },
        };
  await page.screenshot({ path: join(IMAGES, `${name}.png`), ...options });
  await clearMarks(page);
  process.stdout.write(`  ${name}.png\n`);
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(() => !/Loading|Listing\.\.\.|Reading/.test(document.body.innerText), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}
