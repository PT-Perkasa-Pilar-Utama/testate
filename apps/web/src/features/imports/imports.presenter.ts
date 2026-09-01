import * as v from "valibot";
import { createMemo, createSignal } from "solid-js";
import type { ImportReport, ImportRun } from "@testate/shared";

import { attempt } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import { IMPORT_MODE_LABEL } from "@/lib/labels.ts";
import { activeFilterCount, createTableView } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Refreshable } from "@/lib/async.ts";
import { importsModel } from "./imports.model.ts";
import { matchesModeFilter, reportCounts, reportSummary } from "./imports.helpers.ts";

export type ImportSort = "mode" | "actor" | "created_at";
export type ImportModeFilter = ImportRun["mode"] | "";

export type ImportsPresenter = Refreshable<ImportRun[]> & {
  table: TableView<ImportRun, ImportSort>;
  modeFilter: () => ImportModeFilter;
  setModeFilter: (value: ImportModeFilter) => void;
  activeFilters: () => number;
  filtersOpen: () => boolean;
  toggleFilters: () => void;
  report: () => ImportReport | null;
  openReport: (run: ImportRun) => Promise<void>;
  closeReport: () => void;
  rejectedUrl: (runId: string) => string;
};

// `ImportRun.counts` is untyped JSON off the wire; parsed rather than trusted, per house rule.
const countsSchema = v.object({
  inserted: v.optional(v.number(), 0),
  updated: v.optional(v.number(), 0),
  skipped: v.optional(v.number(), 0),
  failed: v.optional(v.number(), 0),
});

/** "Imported 12 rows." while it ran for real; "All 1,204 rows look ready to import." for a preview. */
export function countsLabel(run: ImportRun): string {
  if (run.counts === null) return "in progress";
  const parsed = v.safeParse(countsSchema, run.counts);
  if (!parsed.success) return "counts unavailable";
  return reportSummary(reportCounts({ dry_run: run.dry_run, ...parsed.output }), run.dry_run);
}

export function createImportsPresenter(slug: () => string): ImportsPresenter {
  const runs = createRefreshable(() => importsModel.list(slug()));
  const table = createTableView<ImportRun, ImportSort>({
    rows: () => runs.value(),
    sorters: {
      mode: { text: (run) => run.mode },
      actor: { text: (run) => run.actor.label },
      created_at: { text: (run) => run.created_at },
    },
    // The stored value and the word on screen both match, or a search fails whichever is typed.
    fields: (run) => [run.id, run.mode, IMPORT_MODE_LABEL[run.mode], run.actor.label],
  });
  const [modeFilter, setModeFilter] = createSignal<ImportModeFilter>("");
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const filteredRows = createMemo((): ImportRun[] =>
    table.rows().filter((run) => matchesModeFilter(run.mode, modeFilter()))
  );
  const [report, setReport] = createSignal<ImportReport | null>(null);
  return {
    ...runs,
    table: { ...table, rows: filteredRows },
    modeFilter,
    setModeFilter,
    activeFilters: () => activeFilterCount(modeFilter() !== ""),
    filtersOpen,
    toggleFilters: () => setFiltersOpen((open) => !open),
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
