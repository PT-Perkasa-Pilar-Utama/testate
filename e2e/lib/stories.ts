import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Story = { id: number; section: string; actor: string; title: string };

const ROOT = join(import.meta.dirname, "..", "..");

/** Stories the dashboard cannot show: CI, developer, operator, and agent stories live in API and boot tests. */
const NON_UI: [number, number][] = [
  // Sessions, engine minimums, the deny list, sealing, snapshot progress, host keys, and audit
  // retention have no control of their own on a screen; API and boot tests hold them.
  [8, 9],
  [20, 20],
  [32, 34],
  [74, 74],
  [97, 97],
  [109, 109],
  // 50: XLSX typed cells are engine-tested; Playwright runs on Node without the Bun writer.
  [50, 50],
  [63, 63],
  [70, 70],
  [72, 73],
  [83, 83],
  [86, 86],
  [113, 117],
  [122, 130],
  [134, 139],
];

/**
 * Stories whose screen does not exist in the SPA yet (the project tabs list states, checkouts,
 * diffs, imports, and hooks but offer no actions). E2E cannot cover them until those cards land.
 */
const NO_SCREEN: [number, number][] = [
  // 15: needs a failing restore.
  [15, 15],
  [23, 31],
  [78, 79],
  // 85: no engine reports blocking session ids yet, so the SPA has nothing to terminate.
  [85, 85],
  [107, 107],
  [118, 120],
];

function inRanges(id: number, ranges: [number, number][]): boolean {
  return ranges.some(([from, to]) => id >= from && id <= to);
}

/** The numbered stories of docs/PRD.md §3 with the `###` section each sits under. */
export function prdStories(): Story[] {
  const lines = readFileSync(join(ROOT, "docs", "PRD.md"), "utf8").split("\n");
  const stories: Story[] = [];
  let section = "";
  for (const line of lines) {
    if (line.startsWith("## 4.")) break;
    if (line.startsWith("### ")) section = line.slice(4).trim();
    const match = /^(\d+)\. As (?:an? )?([^,]+), I want (.*)$/.exec(line);
    if (match === null) continue;
    stories.push({
      id: Number(match[1]),
      section,
      actor: match[2] ?? "",
      title: (match[3] ?? "").replace(/, so that.*$/, "").slice(0, 110),
    });
  }
  return stories;
}

export function layerOf(id: number): "ui" | "api" | "no-screen" {
  if (inRanges(id, NON_UI)) return "api";
  if (inRanges(id, NO_SCREEN)) return "no-screen";
  return "ui";
}

/** Every `@story-N` tag across the e2e specs, with the spec files that carry it. */
export function taggedStories(): Map<number, Set<string>> {
  const dir = join(ROOT, "e2e");
  const tags = new Map<number, Set<string>>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".e2e.ts")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    for (const match of text.matchAll(/@story-(\d+)/g)) {
      const id = Number(match[1]);
      tags.set(id, new Set([...(tags.get(id) ?? []), name]));
    }
  }
  return tags;
}

export type CoverageStatus = "covered" | "uncovered" | "no-screen" | "api";

/** The coverage table as markdown plus the counts behind it and any tag that names no story. */
export type CoverageReport = {
  markdown: string;
  counts: Record<CoverageStatus, number>;
  unknownTags: number[];
  total: number;
};

export function coverageReport(): CoverageReport {
  const stories = prdStories();
  const tags = taggedStories();
  const ids = new Set(stories.map((story) => story.id));
  const unknownTags = [...tags.keys()].filter((id) => !ids.has(id));
  const counts = { covered: 0, uncovered: 0, "no-screen": 0, api: 0 };
  const rows = stories.map((story) => {
    const specs = tags.get(story.id);
    const layer = specs === undefined ? layerOf(story.id) : "covered";
    const status: CoverageStatus = layer === "ui" ? "uncovered" : layer;
    counts[status] += 1;
    const files = specs === undefined ? "" : [...specs].join(", ");
    return `| ${story.id} | ${story.section} | ${story.actor} | ${story.title} | ${status} | ${files} |`;
  });
  const markdown = [
    "# E2E story coverage",
    "",
    `Covered ${counts.covered} · uncovered UI ${counts.uncovered} · no screen yet ${counts["no-screen"]} · API-only ${counts.api} · total ${stories.length}`,
    "",
    "| # | Section | Actor | Story | Status | Spec |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  return { markdown, counts, unknownTags, total: stories.length };
}
