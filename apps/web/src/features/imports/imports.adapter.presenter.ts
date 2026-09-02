import { createSignal } from "solid-js";
import type {
  AdapterWithProject,
  ImportReport,
  JsonObject,
  JsonValue,
  Normalizer,
  Preview,
  TableSchema,
} from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { createJobFollower } from "@/lib/sse.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { AUTO, isNullable, toTransforms } from "./imports.columns.ts";
import type { Choice } from "./imports.columns.ts";
import { defaultNormalizerName, runBody, sourceBody, tableKey } from "./imports.helpers.ts";
import type { Source } from "./imports.helpers.ts";
import { importsModel } from "./imports.model.ts";
import { storageModel } from "../storage/storage.model.ts";

/** One file column as the screen holds it: where it goes, and how it is read. */
export type Column = { target: string; source: string; choice: Choice };

export type ImportDraft = {
  /** What this normalizer is saved as. Empty means the table's own name, which nobody picks. */
  name: string;
  table: string;
  mode: Normalizer["mode"];
  key_columns: string;
  sheet: string;
  columns: Column[];
};

export type ImportPresenter = {
  schema: Refreshable<TableSchema[]>;
  /** Loads the preview when the source came from the URL rather than a file picker. */
  rejected: Refreshable<null>;
  storages: Refreshable<AdapterWithProject[]>;
  /** The saved normalizers for the table now chosen, and nothing from any other table. */
  saved: () => Normalizer[];
  /** Loads a saved normalizer's columns, key columns and mode into the draft. */
  reuse: (id: string) => void;
  /** Which saved normalizer this run is going through, empty for a new one. */
  savedId: () => string;
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

const EMPTY: ImportDraft = {
  name: "",
  table: "",
  mode: "append",
  key_columns: "",
  sheet: "",
  columns: [],
};

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
  // Created here, in the presenter's own body: the follower registers its cleanup with the
  // owner that is current at this moment, and there is none inside an effect or after an await.
  const jobs = createJobFollower();
  // Every normalizer this adapter holds; the screen only ever offers the chosen table's.
  const normalizers = createRefreshable(() => importsModel.normalizers(slug(), adapterId()));
  const initial: Source | null =
    rejectedRun === undefined ? null : { kind: "rejected", run_id: rejectedRun };
  const [source, setSource] = createSignal<Source | null>(initial);
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [draft, setDraftSignal] = createSignal<ImportDraft>(EMPTY);
  const [report, setReport] = createSignal<ImportReport | null>(null);
  const [normalizerId, setNormalizerId] = createSignal("");
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
  /** What this run saves under: the name if one was typed, else the table's own. */
  const nameOf = (current: ImportDraft): string =>
    current.name.trim() === "" ? defaultNormalizerName(current.table) : current.name.trim();
  const wire = (): JsonObject => {
    const current = draft();
    const columns = tableOf(current.table)?.columns ?? [];
    const body: JsonObject = {
      name: nameOf(current),
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
   * The normalizer this run goes through, resolved by name.
   *
   * Named within its table, so two tables of one database can each keep a "weekly". Picking a
   * saved one sets `normalizerId` and every run after that updates it in place; typing a name that
   * table has not used yet creates one; leaving the name alone falls back to the table's own name,
   * which is what an import that nobody wants to keep gets.
   *
   * By name and not by table: a table can hold several now, and the first one this list happened
   * to return is somebody's saved work.
   */
  const normalizerFor = async (
    known: string,
    table: string,
    wanted: string,
    body: JsonObject
  ): Promise<string> => {
    const project = slug();
    const adapter = adapterId();
    const same = (one: Normalizer): boolean =>
      one.target === table && one.name.toLowerCase() === wanted.toLowerCase();
    const found =
      known !== "" ? known : (await importsModel.normalizers(project, adapter)).find(same)?.id;
    return found === undefined
      ? (await importsModel.createNormalizer(project, adapter, body)).id
      : (await importsModel.updateNormalizer(project, adapter, found, body)).id;
  };

  const runWith = async (
    staticSource: Source,
    staticDraft: ImportDraft,
    staticNormalizer: string,
    staticBody: JsonObject,
    dryRun: boolean
  ): Promise<{ report: ImportReport; normalizer: string }> => {
    const id = await normalizerFor(
      staticNormalizer,
      staticDraft.table,
      nameOf(staticDraft),
      staticBody
    );
    const job = await importsModel.run(
      slug(),
      runBody(adapterId(), id, staticSource, staticDraft, dryRun)
    );
    // `settle`, not `follow`: this awaits the job while both buttons say busy, and a stream that
    // never reaches a terminal event would leave the screen that way with nothing saying why.
    // Leaving the screen settles it too.
    await jobs.settle(job);
    const found = (await importsModel.list(slug())).find((row) => row.job_id === job.id);
    if (found === undefined) throw new Error("the import run was not recorded");
    return { report: await importsModel.report(slug(), found.id), normalizer: id };
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
    const staticNormalizer = normalizerId();
    const staticBody = wire();
    if (staticSource === null) return Promise.resolve();
    return guarded(async () => {
      const first = await runWith(staticSource, staticDraft, staticNormalizer, staticBody, dryRun);
      setNormalizerId(first.normalizer);
      setReport(first.report);
      if (!commitAfter || first.report.failed > 0) {
        if (!dryRun) onDone();
        return;
      }
      const done = await runWith(staticSource, staticDraft, first.normalizer, staticBody, false);
      setReport(done.report);
      onDone();
    });
  };
  return {
    schema,
    rejected,
    storages,
    saved: () => normalizers.value().filter((one) => one.target === draft().table),
    savedId: normalizerId,
    reuse: (id) => {
      const found = normalizers.value().find((one) => one.id === id);
      if (found === undefined) {
        setNormalizerId("");
        setDraftSignal((current) => ({ ...current, name: "" }));
        return;
      }
      setNormalizerId(found.id);
      setReport(null);
      // A snapshot on purpose: this reads the file that is loaded at the moment of the pick.
      const staticFileColumns = preview()?.columns ?? [];
      setDraftSignal((current) => ({
        ...current,
        name: found.name,
        mode: found.mode,
        key_columns: found.key_columns.join(", "),
        // Only the columns the file actually has: a saved normalizer written for a wider file
        // would otherwise map a column that is not there, and the check would refuse every row.
        columns: current.columns.map((column) => {
          const saved = found.columns.find((one) => one.target === column.target);
          const source = saved?.source ?? "";
          return staticFileColumns.includes(source) ? { ...column, source } : column;
        }),
      }));
    },
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
      setNormalizerId("");
      setReport(null);
      setDraftSignal((current) => ({
        ...current,
        table,
        columns: found === undefined ? [] : match(staticFileColumns, found),
      }));
    },
    setDraft: (patch) => {
      setNormalizerId("");
      setReport(null);
      setDraftSignal((current) => ({ ...current, ...patch }));
    },
    setColumn: (target, patch) => {
      setNormalizerId("");
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
      setNormalizerId("");
      setError(null);
    },
    sampleUrl: (format) => importsModel.sampleUrl(slug(), adapterId(), draft().table, format),
  };
}
