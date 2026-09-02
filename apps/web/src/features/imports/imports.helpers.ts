import type { ImportReport, ImportRun, JsonObject, Mapping, TableSchema } from "@testate/shared";

import { IMPORT_MODE_LABEL } from "@/lib/labels.ts";

export type Source =
  | { kind: "upload"; upload_id: string }
  | { kind: "storage"; adapter_id: string; path: string }
  | { kind: "rejected"; run_id: string };

export function tableKey(table: Pick<TableSchema, "schema" | "name">): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

export function sourceBody(source: Source): JsonObject {
  if (source.kind === "upload") return { upload_id: source.upload_id };
  if (source.kind === "storage") return { adapter_id: source.adapter_id, path: source.path };
  return { rejected_of_run_id: source.run_id };
}

/** The run body; a real run stashes first so a bad file stays reversible (story 57). */
export type RunOptions = { mode: Mapping["mode"]; sheet: string };

export function runBody(
  adapterId: string,
  mappingId: string,
  source: Source,
  draft: RunOptions,
  dryRun: boolean
): JsonObject {
  const body: JsonObject = {
    adapter_id: adapterId,
    mapping_id: mappingId,
    source: sourceBody(source),
    mode: draft.mode,
    dry_run: dryRun,
    stash_first: !dryRun,
  };
  if (draft.sheet !== "") body["options"] = { sheet: draft.sheet };
  return body;
}

// --- Plain-English copy. The wire values above are the API contract and never change; these are
// only what a person reads for them, so the codes above never have to reach a screen unexplained. ---

export const MODE_OPTIONS: ReadonlyArray<{
  value: Mapping["mode"];
  label: string;
  description: string;
}> = [
  {
    value: "append",
    label: IMPORT_MODE_LABEL.append,
    description: "Every row in the file becomes a new row. Nothing already in the table changes.",
  },
  {
    value: "upsert",
    label: IMPORT_MODE_LABEL.upsert,
    description:
      "Rows are matched by the key columns below. New rows are added; matching rows are updated.",
  },
  {
    value: "replace",
    label: IMPORT_MODE_LABEL.replace,
    description: "Every row already in the table is removed first, then these rows are added.",
  },
];

export function modeLabel(mode: Mapping["mode"]): string {
  const found = MODE_OPTIONS.find((option) => option.value === mode);
  return found === undefined ? mode : found.label;
}

/** Whether a run's mode passes the filter; `""` means every mode passes. */
export function matchesModeFilter(
  mode: ImportRun["mode"],
  filter: ImportRun["mode"] | ""
): boolean {
  return filter === "" || mode === filter;
}

/** The table's own name is a fine default, so naming a mapping is only her problem if she edits it. */
export function defaultMappingName(table: string): string {
  const dot = table.lastIndexOf(".");
  return dot === -1 ? table : table.slice(dot + 1);
}

/** Why the primary action is disabled, next to itself; null once it can be pressed. */
export function blockedReason(
  draft: { table: string; mode: Mapping["mode"]; key_columns: string },
  hasPreview: boolean
): string | null {
  if (!hasPreview) return "Load a file first.";
  if (draft.table === "") return "Choose a table to import into.";
  if (draft.mode === "upsert" && draft.key_columns.trim() === "") {
    return "Pick at least one key column below to match rows by.";
  }
  return null;
}

/**
 * Why Import is not available yet, or null when it is.
 *
 * The dry run is the guard. It reads every row against the table it is going for and says what
 * would be refused, and Import stays shut until it comes back clean: a file that is wrong is
 * fixed and loaded again, not pushed at a database to see what sticks. Every edit on the screen
 * clears the last report, so changing the file, the table, the mode or one column closes Import
 * again and the check has to be answered for what is actually there now.
 *
 * A clean dry run is not a promise that every row lands. It reads types, nullability, keys and
 * JSON; foreign keys, unique constraints, checks and triggers are the real run's to find, which
 * is why an import still reports rejected rows and still offers them back as a file (PRD 56).
 */
export function importBlockedReason(
  draft: { table: string; mode: Mapping["mode"]; key_columns: string },
  hasPreview: boolean,
  report: Pick<ImportReport, "dry_run" | "failed"> | null
): string | null {
  const missing = blockedReason(draft, hasPreview);
  if (missing !== null) return missing;
  if (report === null) return "Run the check first.";
  if (!report.dry_run) return null;
  return report.failed > 0 ? "Fix the file and check it again." : null;
}

export type ReportCounts = { ready: number; rejected: number };

/** Written rows for a real run; rows that validated fine for a preview, which never writes anything. */
export function reportCounts(
  report: Pick<ImportReport, "dry_run" | "inserted" | "updated" | "skipped" | "failed">
): ReportCounts {
  return {
    ready: report.dry_run ? report.skipped : report.inserted + report.updated,
    rejected: report.failed,
  };
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-GB")} ${noun}${count === 1 ? "" : "s"}`;
}

function verb(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** The passive fact: what a preview found, or what a run did. Never "inserted 0 updated 0 skipped 1204". */
export function reportSummary(counts: ReportCounts, dryRun: boolean): string {
  if (dryRun) {
    if (counts.rejected === 0) {
      return `All ${plural(counts.ready, "row")} ${verb(counts.ready, "looks", "look")} ready to import.`;
    }
    return `${plural(counts.ready, "row")} ready. ${plural(counts.rejected, "row")} will be rejected.`;
  }
  if (counts.rejected === 0) return `Imported ${plural(counts.ready, "row")}.`;
  return `Imported ${plural(counts.ready, "row")}. ${plural(counts.rejected, "row")} ${verb(counts.rejected, "was", "were")} rejected.`;
}
