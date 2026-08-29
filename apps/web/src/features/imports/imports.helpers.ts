import type { JsonObject, Mapping, TableSchema } from "@testate/shared";

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
  const body: JsonObject = {
    name: draft.name.trim(),
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
