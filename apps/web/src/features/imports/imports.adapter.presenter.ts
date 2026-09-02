import { createSignal } from "solid-js";
import type {
  AdapterWithProject,
  ImportReport,
  JsonObject,
  JsonValue,
  Mapping,
  Preview,
  TableSchema,
} from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { AUTO, isNullable, toTransforms } from "./imports.columns.ts";
import type { Choice } from "./imports.columns.ts";
import { defaultMappingName, runBody, sourceBody, tableKey } from "./imports.helpers.ts";
import type { Source } from "./imports.helpers.ts";
import { importsModel } from "./imports.model.ts";
import { storageModel } from "../storage/storage.model.ts";

/** One file column as the screen holds it: where it goes, and how it is read. */
export type Column = { target: string; source: string; choice: Choice };

export type ImportDraft = {
  table: string;
  mode: Mapping["mode"];
  key_columns: string;
  sheet: string;
  columns: Column[];
};

export type ImportPresenter = {
  schema: Refreshable<TableSchema[]>;
  /** Loads the preview when the source came from the URL rather than a file picker. */
  rejected: Refreshable<null>;
  storages: Refreshable<AdapterWithProject[]>;
  source: () => Source | null;
  preview: () => Preview | null;
  draft: () => ImportDraft;
  report: () => ImportReport | null;
  busy: () => boolean;
  error: () => string | null;
  /** How many columns the file filled by name, out of the ones the table wants. */
  matched: () => { filled: number; total: number };
  upload: (file: File) => Promise<void>;
  useStorage: (adapterId: string, path: string) => Promise<void>;
  setSheet: (sheet: string) => Promise<void>;
  setTable: (table: string) => void;
  setDraft: (patch: Partial<ImportDraft>) => void;
  setColumn: (target: string, patch: Partial<Column>) => void;
  /** Dry run first; if nothing would be rejected it commits without asking twice. */
  /** The dry run. Nothing is written, and its report is what opens `commit`. */
  check: () => Promise<void>;
  commit: () => Promise<void>;
  clear: () => void;
  sampleUrl: (format: "csv" | "xlsx") => string;
};

const EMPTY: ImportDraft = { table: "", mode: "append", key_columns: "", sheet: "", columns: [] };

/** File columns onto table columns by name, case-insensitive; generated columns are not ours to fill. */
function match(fileColumns: readonly string[], table: TableSchema): Column[] {
  const byName = new Map(fileColumns.map((name) => [name.toLowerCase(), name]));
  return table.columns
    .filter((column) => !column.generated && !column.identity)
    .map((column) => ({
      target: column.name,
      source: byName.get(column.name.toLowerCase()) ?? "",
      choice: AUTO,
    }));
}

export function createImportPresenter(
  slug: () => string,
  adapterId: () => string,
  onDone: () => void,
  /** A run whose rejected rows are the source, from `?rejected=` on the way in. */
  rejectedRun?: string
): ImportPresenter {
  const initial: Source | null =
    rejectedRun === undefined ? null : { kind: "rejected", run_id: rejectedRun };
  const [source, setSource] = createSignal<Source | null>(initial);
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [draft, setDraftSignal] = createSignal<ImportDraft>(EMPTY);
  const [report, setReport] = createSignal<ImportReport | null>(null);
  const [mappingId, setMappingId] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // A rejected-rows source has no file to pick, so its preview loads with the screen.
  const rejected = createRefreshable(async () => {
    if (initial === null) return null;
    setPreview(await importsModel.preview(slug(), { source: sourceBody(initial) }));
    return null;
  });
  const schema = createRefreshable(
    async () => (await adapterModel.schema(slug(), adapterId())).tables
  );
  const storages = createRefreshable(async () =>
    (await storageModel.stores()).filter((store) => store.project_slug === slug())
  );
  const guarded = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause: unknown) {
      setError(humanMessage(cause, "Could not run that import."));
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = async (next: Source, sheet: string): Promise<void> => {
    const body: JsonObject = { source: sourceBody(next) };
    if (sheet !== "") body["options"] = { sheet };
    setPreview(await importsModel.preview(slug(), body));
  };
  const tableOf = (name: string): TableSchema | undefined =>
    schema.value().find((candidate) => tableKey(candidate) === name);
  const wire = (): JsonObject => {
    const current = draft();
    const columns = tableOf(current.table)?.columns ?? [];
    const body: JsonObject = {
      name: defaultMappingName(current.table),
      target: current.table,
      columns: current.columns.map((column) => ({
        source: column.source === "" ? null : column.source,
        target: column.target,
        // SAFETY: `toTransforms` returns the wire shape itself, parsed from `transformSchema` at
        // the other end; the cast only tells the JSON body's type what it already is.
        transforms: toTransforms(column.choice, isNullable(columns, column.target)) as JsonValue,
      })),
      key_columns: current.key_columns
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== ""),
      mode: current.mode,
    };
    if (current.sheet !== "") body["options"] = { sheet: current.sheet };
    return body;
  };
  /**
   * One attempt, from values read before it starts.
   *
   * Signals are snapshotted by the caller, not read in here: an async body that reads a signal
   * after its first await is reading whatever the screen holds by then, which is the bug the
   * `solid(reactivity)` rule exists to catch.
   */
  /**
   * The mapping this run goes through, created once and updated after that.
   *
   * There is no name field on this screen any more, so the name is the table's and there can only
   * be one mapping per table. A check that created a second would be refused with "mapping name
   * is taken", which is exactly what checking a file, fixing it and checking it again does.
   */
  const mappingFor = async (known: string, table: string, body: JsonObject): Promise<string> => {
    if (known !== "") {
      return (await importsModel.updateMapping(slug(), adapterId(), known, body)).id;
    }
    const existing = (await importsModel.mappings(slug(), adapterId())).find(
      (mapping) => mapping.target === table
    );
    if (existing === undefined) {
      return (await importsModel.createMapping(slug(), adapterId(), body)).id;
    }
    return (await importsModel.updateMapping(slug(), adapterId(), existing.id, body)).id;
  };

  const runWith = async (
    staticSource: Source,
    staticDraft: ImportDraft,
    staticMapping: string,
    staticBody: JsonObject,
    dryRun: boolean
  ): Promise<{ report: ImportReport; mapping: string }> => {
    const id = await mappingFor(staticMapping, staticDraft.table, staticBody);
    const job = await importsModel.run(
      slug(),
      runBody(adapterId(), id, staticSource, staticDraft, dryRun)
    );
    await new Promise<void>((resolve) => {
      followJob(job, () => resolve());
    });
    const found = (await importsModel.list(slug())).find((row) => row.job_id === job.id);
    if (found === undefined) throw new Error("the import run was not recorded");
    return { report: await importsModel.report(slug(), found.id), mapping: id };
  };

  /**
   * One press.
   *
   * Every signal is read here, before the first await; the async body below works from those
   * values alone. `commitAfter` is left in place for a caller that wants both halves on one
   * press; the screen no longer asks for that, because the check is what opens Import.
   */
  const attempt = (dryRun: boolean, commitAfter: boolean): Promise<void> => {
    const staticSource = source();
    const staticDraft = draft();
    const staticMapping = mappingId();
    const staticBody = wire();
    if (staticSource === null) return Promise.resolve();
    return guarded(async () => {
      const first = await runWith(staticSource, staticDraft, staticMapping, staticBody, dryRun);
      setMappingId(first.mapping);
      setReport(first.report);
      if (!commitAfter || first.report.failed > 0) {
        if (!dryRun) onDone();
        return;
      }
      const done = await runWith(staticSource, staticDraft, first.mapping, staticBody, false);
      setReport(done.report);
      onDone();
    });
  };
  return {
    schema,
    rejected,
    storages,
    source,
    preview,
    draft,
    report,
    busy,
    error,
    matched: () => {
      const columns = draft().columns;
      return {
        filled: columns.filter((column) => column.source !== "").length,
        total: columns.length,
      };
    },
    upload: (file) =>
      guarded(async () => {
        const uploaded = await importsModel.upload(slug(), file);
        const next: Source = { kind: "upload", upload_id: uploaded.upload_id };
        setSource(next);
        setReport(null);
        await loadPreview(next, "");
      }),
    useStorage: (storageId, path) =>
      guarded(async () => {
        const next: Source = { kind: "storage", adapter_id: storageId, path };
        setSource(next);
        setReport(null);
        await loadPreview(next, "");
      }),
    setSheet: (sheet) => {
      const staticSource = source();
      setDraftSignal((current) => ({ ...current, sheet }));
      return staticSource === null
        ? Promise.resolve()
        : guarded(() => loadPreview(staticSource, sheet));
    },
    setTable: (table) => {
      const found = tableOf(table);
      const staticFileColumns = preview()?.columns ?? [];
      setMappingId("");
      setReport(null);
      setDraftSignal((current) => ({
        ...current,
        table,
        columns: found === undefined ? [] : match(staticFileColumns, found),
      }));
    },
    setDraft: (patch) => {
      setMappingId("");
      setReport(null);
      setDraftSignal((current) => ({ ...current, ...patch }));
    },
    setColumn: (target, patch) => {
      setMappingId("");
      setReport(null);
      setDraftSignal((current) => ({
        ...current,
        columns: current.columns.map((column) =>
          column.target === target ? { ...column, ...patch } : column
        ),
      }));
    },
    // The check, and only the check. It used to import too whenever nothing was rejected, which
    // meant the one press that asked "is this file right?" was also the press that wrote it.
    check: () => attempt(true, false),
    commit: () => attempt(false, false),
    clear: () => {
      setSource(null);
      setPreview(null);
      setDraftSignal(EMPTY);
      setReport(null);
      setMappingId("");
      setError(null);
    },
    sampleUrl: (format) => importsModel.sampleUrl(slug(), adapterId(), draft().table, format),
  };
}
