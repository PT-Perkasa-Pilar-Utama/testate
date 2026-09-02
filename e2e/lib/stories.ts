import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Story = { id: number; section: string; actor: string; title: string };

const ROOT = join(import.meta.dirname, "..", "..");

/**
 * Stories no screen shows. Every one of them is covered through the API instead: contract and
 * agent stories in `api.e2e.ts` and `agent.e2e.ts`, boot and key stories in `boot.e2e.ts`, engine
 * behaviour in `engine.e2e.ts`, `types.e2e.ts`, `session.e2e.ts`, and `storage.e2e.ts`. So this
 * list is empty. Put an id back only when a story genuinely cannot be exercised at all.
 */
const NON_UI: [number, number][] = [];

/** Stories whose screen does not exist in the SPA; empty since 2026-08-29. */
const NO_SCREEN: [number, number][] = [];

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
