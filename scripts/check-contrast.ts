/**
 * Both palettes, held to the same contrast floors.
 *
 * A theme is easy to half-break: someone adjusts one colour in dark, the light block keeps the old
 * pairing, and nothing complains because nothing reads them together. This does. It parses the
 * tokens out of `app.css` rather than repeating them, so a value can only be wrong in one place.
 *
 * WCAG AA: 4.5:1 for text, 3:1 for a control's boundary. The focus ring is the one people forget,
 * and it is the one a keyboard user cannot work without.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = join(import.meta.dirname, "..", "apps", "web", "src", "styles", "app.css");

/** The `--color-*` declarations inside one block, keyed by token name without the prefix. */
function tokensIn(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) found.set(name, value.trim());
  }
  return found;
}

type Rgb = { r: number; g: number; b: number };

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** `#rgb`, `#rrggbb`, or `rgba(r, g, b, a)` composited over `over`. */
function channels(value: string, over: Rgb): Rgb {
  const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(value);
  if (rgba !== null) {
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    const mix = (raw: string | undefined, ground: number): number =>
      Number(raw ?? 0) * alpha + ground * (1 - alpha);
    return { r: mix(rgba[1], over.r), g: mix(rgba[2], over.g), b: mix(rgba[3], over.b) };
  }
  const hex = value.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex;
  const at = (start_: number): number => Number.parseInt(full.slice(start_, start_ + 2), 16);
  return { r: at(0), g: at(2), b: at(4) };
}

function channel(raw: number): number {
  const part = raw / 255;
  return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function ratio(front: string, back: string): number {
  const ground = channels(back, BLACK);
  const one = luminance(channels(front, ground));
  const two = luminance(ground);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/** Every pair that has to hold, in both themes. */
const PAIRS: ReadonlyArray<{ front: string; back: string; least: number; why: string }> = [
  { front: "body", back: "canvas", least: 4.5, why: "what you read, on the page" },
  { front: "body", back: "surface", least: 4.5, why: "what you read, on a card" },
  { front: "muted", back: "canvas", least: 4.5, why: "what you skim is still text" },
  { front: "muted", back: "surface", least: 4.5, why: "the same, on a card" },
  { front: "heading", back: "canvas", least: 4.5, why: "headings" },
  { front: "placeholder", back: "control", least: 4.5, why: "an empty input still reads" },
  { front: "on-accent", back: "accent", least: 4.5, why: "the primary button's own label" },
  { front: "link", back: "canvas", least: 4.5, why: "a link is text" },
  // 3:1 is the floor for a boundary rather than a glyph. The focus ring is the whole reason this
  // file exists: cyan on white measures 1.5 and a keyboard user simply loses the cursor.
  { front: "accent", back: "canvas", least: 3, why: "the focus ring against the page" },
  { front: "line", back: "canvas", least: 1.4, why: "a card's edge has to be visible at all" },
  { front: "success-fg", back: "success-tint", least: 4.5, why: "status text on its wash" },
  { front: "warning-fg", back: "warning-tint", least: 4.5, why: "status text on its wash" },
  { front: "danger-fg", back: "danger-tint", least: 4.5, why: "status text on its wash" },
  { front: "info-fg", back: "info-tint", least: 4.5, why: "status text on its wash" },
  { front: "success-fg", back: "canvas", least: 3, why: "status text on the page" },
  { front: "danger-fg", back: "canvas", least: 3, why: "status text on the page" },
];

const css = readFileSync(CSS, "utf8");
const dark = tokensIn(/@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "");
const light = tokensIn(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "");

if (dark.size === 0) throw new Error("no dark tokens found in app.css");
if (light.size === 0) throw new Error("no light tokens found in app.css");

const missing = [...dark.keys()].filter((name) => !light.has(name));
const failures: string[] = [];

// A token the light block forgets silently keeps its dark value, which is how a theme half-breaks.
for (const name of missing) failures.push(`light is missing --color-${name}`);

for (const [theme, palette] of [
  ["dark", dark],
  ["light", light],
] as const) {
  for (const pair of PAIRS) {
    const front = palette.get(pair.front);
    const back = palette.get(pair.back);
    if (front === undefined || back === undefined) continue;
    const measured = ratio(front, back);
    if (measured + 0.005 < pair.least) {
      failures.push(
        `${theme}: ${pair.front} on ${pair.back} is ${measured.toFixed(2)}:1, needs ` +
          `${pair.least}:1 (${pair.why})`
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.stderr.write(`\n${failures.length} contrast failure(s).\n`);
  process.exit(1);
}

process.stdout.write(
  `both themes pass ${PAIRS.length} contrast checks over ${dark.size} tokens.\n`
);
