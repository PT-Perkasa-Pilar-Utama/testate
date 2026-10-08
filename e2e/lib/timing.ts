import { appendFileSync } from "node:fs";

import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/** One finished test: which project, when it started, how long it ran. */
export type Run = { project: string; start: number; duration: number };

export type ProjectTime = { project: string; tests: number; wallMs: number; busyMs: number };

/**
 * Wall-clock time per project, first start to last end, and the summed test time inside it.
 * Wall time is what a run waits for; busy time over wall time is how well the workers were used.
 */
export function projectTimes(runs: readonly Run[]): ProjectTime[] {
  const byProject = new Map<string, Run[]>();
  for (const run of runs) byProject.set(run.project, [...(byProject.get(run.project) ?? []), run]);
  return [...byProject].map(([project, list]) => {
    const start = Math.min(...list.map((run) => run.start));
    const end = Math.max(...list.map((run) => run.start + run.duration));
    const busyMs = list.reduce((sum, run) => sum + run.duration, 0);
    return { project, tests: list.length, wallMs: end - start, busyMs };
  });
}

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

export function timingTable(times: readonly ProjectTime[], totalMs: number): string {
  const rows = [...times]
    .sort((a, b) => b.wallMs - a.wallMs)
    .map(
      (time) =>
        `| ${time.project} | ${time.tests} | ${seconds(time.wallMs)} | ${seconds(time.busyMs)} |`
    );
  return [
    "### Browser end-to-end time per project",
    "",
    "| Project | Tests | Wall s | Busy s |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
    "",
    `Whole run: ${seconds(totalMs)} s.`,
    "",
  ].join("\n");
}

/**
 * Records how long each project takes, so a change to the suite's shape (#40) is measured on CI
 * rather than guessed. Prints the table, and writes it to the job summary on GitHub Actions.
 */
export default class TimingReporter implements Reporter {
  private readonly runs: Run[] = [];
  private begun = Date.now();

  onBegin(): void {
    this.begun = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === "skipped") return;
    const project = test.parent.project()?.name ?? "default";
    this.runs.push({ project, start: result.startTime.getTime(), duration: result.duration });
  }

  onEnd(): void {
    const table = timingTable(projectTimes(this.runs), Date.now() - this.begun);
    process.stdout.write(`\n${table}`);
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary !== undefined && summary !== "") appendFileSync(summary, table);
  }
}
