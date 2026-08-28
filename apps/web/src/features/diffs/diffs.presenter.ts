import type { Diff } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { diffsModel } from "./diffs.model.ts";

export type DiffsPresenter = Refreshable<Diff[]>;

export function createDiffsPresenter(slug: () => string): DiffsPresenter {
  return createRefreshable(() => diffsModel.list(slug()));
}

export function targetLabel(target: Diff["target"]): string {
  return "live" in target ? "live database" : target.name;
}

/** Sum of added + removed + changed rows over every compared table. */
export function changedRows(diff: Diff): number {
  return diff.adapters
    .flatMap((adapter) => adapter.tables)
    .reduce((total, table) => total + table.added + table.removed + table.changed, 0);
}
