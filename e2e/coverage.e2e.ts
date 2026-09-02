import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { E2E_DIR } from "../playwright.config.ts";
import { coverageReport } from "./lib/stories.ts";

/**
 * Story coverage report: every PRD story is `covered` (a spec carries its `@story-N` tag), `api`
 * (no dashboard surface: CI, operator, agent), `no-screen` (the SPA has no action for it yet), or
 * `uncovered`. The report lands in `.e2e/coverage.md`; a tag that names no story fails the run.
 */
test("every @story tag names a PRD story, and the coverage report is written", () => {
  const report = coverageReport();
  mkdirSync(E2E_DIR, { recursive: true });
  writeFileSync(join(E2E_DIR, "coverage.md"), report.markdown);
  expect(report.unknownTags).toStrictEqual([]);
  expect(report.total).toBe(147);
  expect(report.counts.covered).toBeGreaterThanOrEqual(30);
});
