import type { ImportRun } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { importsModel } from "./imports.model.ts";

export type ImportsPresenter = Refreshable<ImportRun[]>;

export function createImportsPresenter(slug: () => string): ImportsPresenter {
  return createRefreshable(() => importsModel.list(slug()));
}

/** "inserted 12, updated 3" from the counts object; "pending" while the job runs. */
export function countsLabel(run: ImportRun): string {
  if (run.counts === null) return "pending";
  return Object.entries(run.counts)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(", ");
}
