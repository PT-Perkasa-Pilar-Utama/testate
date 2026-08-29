import { createSignal } from "solid-js";
import type {
  Adapter,
  ImportReport,
  JsonObject,
  Mapping,
  Preview,
  TableSchema,
} from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import {
  draftFromMapping,
  guessColumns,
  mappingBody,
  runBody,
  sourceBody,
  tableKey,
} from "./imports.helpers.ts";
import type { ColumnDraft, MappingDraft, Source } from "./imports.helpers.ts";
import { importsModel } from "./imports.model.ts";

export type WizardPresenter = {
  open: () => boolean;
  source: () => Source | null;
  preview: () => Preview | null;
  adapterId: () => string;
  tables: () => TableSchema[];
  mappings: () => Mapping[];
  mappingId: () => string;
  draft: () => MappingDraft;
  report: () => ImportReport | null;
  busy: () => boolean;
  error: () => string | null;
  databases: Refreshable<Adapter[]>;
  start: (source?: Source) => void;
  close: () => void;
  upload: (file: File) => Promise<void>;
  setSheet: (sheet: string) => Promise<void>;
  setAdapter: (id: string) => Promise<void>;
  setTable: (table: string) => void;
  pickMapping: (id: string) => void;
  setDraft: (patch: Partial<MappingDraft>) => void;
  setColumn: (target: string, patch: Partial<ColumnDraft>) => void;
  run: (dryRun: boolean) => Promise<void>;
  sampleUrl: (format: "csv" | "xlsx") => string;
};

const EMPTY: MappingDraft = {
  name: "",
  table: "",
  columns: [],
  mode: "append",
  key_columns: "",
  sheet: "",
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "request failed";
}

export function createWizardPresenter(slug: () => string, onDone: () => void): WizardPresenter {
  const [open, setOpen] = createSignal(false);
  const [source, setSource] = createSignal<Source | null>(null);
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [adapterId, setAdapterId] = createSignal("");
  const [tables, setTables] = createSignal<TableSchema[]>([]);
  const [mappings, setMappings] = createSignal<Mapping[]>([]);
  const [mappingId, setMappingId] = createSignal("");
  const [draft, setDraftSignal] = createSignal<MappingDraft>(EMPTY);
  const [report, setReport] = createSignal<ImportReport | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const databases = createRefreshable(async () =>
    (await adaptersModel.list(slug())).filter(
      (adapter) => adapter.kind === "database" && adapter.tier === "tabular"
    )
  );
  const guarded = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = async (staticSource: Source, sheet: string): Promise<void> => {
    const body: JsonObject = { source: sourceBody(staticSource) };
    if (sheet !== "") body["options"] = { sheet };
    setPreview(await importsModel.preview(slug(), body));
  };
  const reset = (): void => {
    setSource(null);
    setPreview(null);
    setAdapterId("");
    setTables([]);
    setMappings([]);
    setMappingId("");
    setDraftSignal(EMPTY);
    setReport(null);
    setError(null);
  };
  return {
    open,
    source,
    preview,
    adapterId,
    tables,
    mappings,
    mappingId,
    draft,
    report,
    busy,
    error,
    databases,
    start: (initial) => {
      reset();
      setOpen(true);
      if (initial === undefined) return;
      setSource(initial);
      void guarded(() => loadPreview(initial, ""));
    },
    close: () => {
      setOpen(false);
      reset();
    },
    upload: (file) =>
      guarded(async () => {
        const uploaded = await importsModel.upload(slug(), file);
        const next: Source = { kind: "upload", upload_id: uploaded.upload_id };
        setSource(next);
        await loadPreview(next, "");
      }),
    setSheet: (sheet) => {
      const staticSource = source();
      setDraftSignal((current) => ({ ...current, sheet }));
      return staticSource === null
        ? Promise.resolve()
        : guarded(() => loadPreview(staticSource, sheet));
    },
    setAdapter: (id) =>
      guarded(async () => {
        setAdapterId(id);
        setMappingId("");
        setDraftSignal((current) => ({ ...current, table: "", columns: [] }));
        const [schema, saved] = await Promise.all([
          adapterModel.schema(slug(), id),
          importsModel.mappings(slug(), id),
        ]);
        setTables(schema.tables);
        setMappings(saved);
      }),
    setTable: (table) => {
      const staticFound = tables().find((candidate) => tableKey(candidate) === table);
      const staticColumns = preview()?.columns ?? [];
      setMappingId("");
      setDraftSignal((current) => ({
        ...current,
        table,
        columns: staticFound === undefined ? [] : guessColumns(staticColumns, staticFound),
      }));
    },
    pickMapping: (id) => {
      const found = mappings().find((mapping) => mapping.id === id);
      setMappingId(id);
      if (found !== undefined) setDraftSignal(draftFromMapping(found));
    },
    setDraft: (patch) => setDraftSignal((current) => ({ ...current, ...patch })),
    setColumn: (target, patch) =>
      setDraftSignal((current) => ({
        ...current,
        columns: current.columns.map((column) =>
          column.target === target ? { ...column, ...patch } : column
        ),
      })),
    run: (dryRun) => {
      const staticSource = source();
      const staticAdapter = adapterId();
      const staticDraft = draft();
      const staticMapping = mappingId();
      const staticSlug = slug();
      if (staticSource === null) return Promise.resolve();
      return guarded(async () => {
        const id =
          staticMapping === ""
            ? (
                await importsModel.createMapping(
                  staticSlug,
                  staticAdapter,
                  mappingBody(staticDraft)
                )
              ).id
            : staticMapping;
        setMappingId(id);
        const job = await importsModel.run(
          staticSlug,
          runBody(staticAdapter, id, staticSource, staticDraft, dryRun)
        );
        await new Promise<void>((resolve) => {
          followJob(job, () => resolve());
        });
        const run = (await importsModel.list(staticSlug)).find((row) => row.job_id === job.id);
        if (run === undefined) throw new Error("the import run was not recorded");
        setReport(await importsModel.report(staticSlug, run.id));
        onDone();
      });
    },
    sampleUrl: (format) => importsModel.sampleUrl(slug(), adapterId(), draft().table, format),
  };
}
