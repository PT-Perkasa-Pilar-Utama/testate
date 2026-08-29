import { createSignal } from "solid-js";
import type { ImportReport, ImportRun } from "@testate/shared";

import { attempt } from "@/components/toast.tsx";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { importsModel } from "./imports.model.ts";

export type ImportsPresenter = Refreshable<ImportRun[]> & {
  report: () => ImportReport | null;
  openReport: (run: ImportRun) => Promise<void>;
  closeReport: () => void;
  rejectedUrl: (runId: string) => string;
};

/** "inserted 12, updated 3" from the counts object; "pending" while the job runs. */
export function countsLabel(run: ImportRun): string {
  if (run.counts === null) return "pending";
  return Object.entries(run.counts)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(", ");
}

export function createImportsPresenter(slug: () => string): ImportsPresenter {
  const runs = createRefreshable(() => importsModel.list(slug()));
  const [report, setReport] = createSignal<ImportReport | null>(null);
  return {
    ...runs,
    report,
    openReport: (run) => {
      const staticSlug = slug();
      return attempt(async () => {
        setReport(await importsModel.report(staticSlug, run.id));
      });
    },
    closeReport: () => setReport(null),
    rejectedUrl: (runId) => importsModel.rejectedUrl(slug(), runId),
  };
}
