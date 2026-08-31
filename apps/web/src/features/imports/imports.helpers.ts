import type { ImportReport, JsonObject, Mapping, TableSchema } from "@testate/shared";

export const TRANSFORMS = ["", "trim", "emptyToNull", "number", "uuid", "now", "json"] as const;
export type Transform = (typeof TRANSFORMS)[number];
export type ColumnDraft = { target: string; source: string; transform: Transform };
export type Source =
  | { kind: "upload"; upload_id: string }
  | { kind: "storage"; adapter_id: string; path: string }
  | { kind: "rejected"; run_id: string };

export type MappingDraft = {
  name: string;
  table: string;
  columns: ColumnDraft[];
  mode: Mapping["mode"];
  key_columns: string;
  sheet: string;
};

export function tableKey(table: Pick<TableSchema, "schema" | "name">): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

/** Matches file columns to table columns by name, case-insensitive; generated columns are left out (story 52). */
export function guessColumns(fileColumns: string[], table: TableSchema): ColumnDraft[] {
  const byName = new Map(fileColumns.map((name) => [name.toLowerCase(), name]));
  return table.columns
    .filter((column) => !column.generated && !column.identity)
    .map((column) => ({
      target: column.name,
      source: byName.get(column.name.toLowerCase()) ?? "",
      transform: "",
    }));
}

/** A saved mapping back into the form so it can be reused as is (story 54). */
export function draftFromMapping(mapping: Mapping): MappingDraft {
  return {
    name: mapping.name,
    table: mapping.target,
    columns: mapping.columns.map((column) => ({
      target: column.target,
      source: column.source ?? "",
      transform:
        column.transforms[0]?.kind === undefined ? "" : toTransform(column.transforms[0].kind),
    })),
    mode: mapping.mode,
    key_columns: mapping.key_columns.join(", "),
    sheet: mapping.options.sheet ?? "",
  };
}

function toTransform(kind: string): Transform {
  const found = TRANSFORMS.find((transform) => transform === kind);
  return found ?? "";
}

export function sourceBody(source: Source): JsonObject {
  if (source.kind === "upload") return { upload_id: source.upload_id };
  if (source.kind === "storage") return { adapter_id: source.adapter_id, path: source.path };
  return { rejected_of_run_id: source.run_id };
}

export function mappingBody(draft: MappingDraft): JsonObject {
  // A cleared name never blocks a run: it falls back to the same default she saw in the field.
  const name = draft.name.trim() === "" ? defaultMappingName(draft.table) : draft.name.trim();
  const body: JsonObject = {
    name,
    target: draft.table,
    columns: draft.columns.map((column) => ({
      source: column.source === "" ? null : column.source,
      target: column.target,
      transforms: column.transform === "" ? [] : [{ kind: column.transform }],
    })),
    key_columns: draft.key_columns
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
    mode: draft.mode,
  };
  if (draft.sheet !== "") body["options"] = { sheet: draft.sheet };
  return body;
}

/** The run body; a real run stashes first so a bad file stays reversible (story 57). */
export function runBody(
  adapterId: string,
  mappingId: string,
  source: Source,
  draft: MappingDraft,
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

export const TRANSFORM_OPTIONS: ReadonlyArray<{ value: Transform; label: string }> = [
  { value: "", label: "Leave as is" },
  { value: "trim", label: "Trim extra spaces" },
  { value: "emptyToNull", label: "Treat blank cells as no value" },
  { value: "number", label: "Convert text to a number" },
  { value: "uuid", label: "Generate a unique ID" },
  { value: "now", label: "Fill in today's date and time" },
  { value: "json", label: "Read as structured data (JSON)" },
];

export const MODE_OPTIONS: ReadonlyArray<{
  value: Mapping["mode"];
  label: string;
  description: string;
}> = [
  {
    value: "append",
    label: "Add these rows",
    description: "Every row in the file becomes a new row. Nothing already in the table changes.",
  },
  {
    value: "upsert",
    label: "Add new rows, update existing ones",
    description:
      "Rows are matched by the key columns below. New rows are added; matching rows are updated.",
  },
  {
    value: "replace",
    label: "Clear the table, then load this file",
    description: "Every row already in the table is removed first, then these rows are added.",
  },
];

export function modeLabel(mode: Mapping["mode"]): string {
  const found = MODE_OPTIONS.find((option) => option.value === mode);
  return found === undefined ? mode : found.label;
}

/** The table's own name is a fine default, so naming a mapping is only her problem if she edits it. */
export function defaultMappingName(table: string): string {
  const dot = table.lastIndexOf(".");
  return dot === -1 ? table : table.slice(dot + 1);
}

/** Why the primary action is disabled, next to itself; null once she can press it. */
export function blockedReason(draft: MappingDraft, hasPreview: boolean): string | null {
  if (!hasPreview) return "Load a file first.";
  if (draft.table === "") return "Choose a table to import into.";
  if (draft.mode === "upsert" && draft.key_columns.trim() === "") {
    return "Pick at least one key column below to match rows by.";
  }
  return null;
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

/** The commit question beside the button that actually writes data: a fact, not a second blind press. */
export function commitPrompt(counts: ReportCounts): string {
  if (counts.ready === 0) return "Every row will be rejected. Fix the file and try again.";
  if (counts.rejected === 0) {
    const subject = counts.ready === 1 ? "it" : "them";
    return `All ${plural(counts.ready, "row")} ${verb(counts.ready, "is", "are")} ready. Import ${subject}?`;
  }
  return `${plural(counts.rejected, "row")} will be rejected. Import the other ${counts.ready.toLocaleString("en-GB")}?`;
}
