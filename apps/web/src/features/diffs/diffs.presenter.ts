import { createSignal } from "solid-js";
import type { Diff, DiffRow, JsonObject, State } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { statesModel } from "../states/states.model.ts";
import { diffsModel } from "./diffs.model.ts";
import type { DiffRowsPage } from "./diffs.model.ts";

export const LIVE = "live";
export type DiffDraft = { base_state_id: string; target: string };
export type RowsTarget = { diff: Diff; adapter_id: string; adapter_name: string; table: string };

export type DiffsPresenter = Refreshable<Diff[]> & {
  states: Refreshable<State[]>;
  creating: () => boolean;
  draft: () => DiffDraft;
  error: () => string | null;
  detail: () => Diff | null;
  rows: () => { target: RowsTarget; page: DiffRowsPage; op: DiffRow["op"] | "" } | null;
  openCreate: () => void;
  openDetail: (diff: Diff) => Promise<void>;
  openRows: (target: RowsTarget, op?: DiffRow["op"] | "") => Promise<void>;
  close: () => void;
  closeRows: () => void;
  setDraft: (patch: Partial<DiffDraft>) => void;
  create: () => Promise<void>;
  remove: (diff: Diff) => Promise<void>;
  exportUrl: (diff: Diff, format: "csv" | "jsonl") => string;
};

export function targetLabel(target: Diff["target"]): string {
  return "live" in target ? "live database" : target.name;
}

/** Sum of added + removed + changed rows over every compared table. */
export function changedRows(diff: Pick<Diff, "adapters">): number {
  return diff.adapters
    .flatMap((adapter) => adapter.tables)
    .reduce((total, table) => total + table.added + table.removed + table.changed, 0);
}

export type DiffTable = Diff["adapters"][number]["tables"][number];
export type DiffAdapter = Diff["adapters"][number];
export type Totals = { added: number; removed: number; changed: number; tables: number };

/** A table counts as touched when rows moved or its schema did. */
export function touched(table: DiffTable): boolean {
  return !table.unchanged || table.schema_changed !== null;
}

export function totalsOf(tables: readonly DiffTable[]): Totals {
  return tables.reduce<Totals>(
    (sum, table) => ({
      added: sum.added + table.added,
      removed: sum.removed + table.removed,
      changed: sum.changed + table.changed,
      tables: sum.tables + (touched(table) ? 1 : 0),
    }),
    { added: 0, removed: 0, changed: 0, tables: 0 }
  );
}

export function diffTotals(diff: Pick<Diff, "adapters">): Totals {
  return totalsOf(diff.adapters.flatMap((adapter) => adapter.tables));
}

/** The tables one adapter should show: touched ones always, the rest only when asked. */
export function tablesToShow(
  adapter: DiffAdapter,
  showUnchanged: boolean,
  filter: string
): DiffTable[] {
  const needle = filter.trim().toLowerCase();
  return adapter.tables.filter((table) => {
    if (!showUnchanged && !touched(table)) return false;
    if (needle === "") return true;
    return tableLabel(table).toLowerCase().includes(needle);
  });
}

export function tableLabel(table: DiffTable): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

/** How many tables the diff holds, and how many of them it is currently hiding. */
export function hiddenCount(diff: Pick<Diff, "adapters">): number {
  return diff.adapters.flatMap((adapter) => adapter.tables).filter((table) => !touched(table))
    .length;
}

/** The create body: a state id, or the literal "live" for the live database (stories 88, 89). */
export function toCreateBody(draft: DiffDraft): JsonObject {
  return {
    base_state_id: draft.base_state_id,
    target: draft.target === LIVE ? LIVE : { state_id: draft.target },
  };
}

/** A diff row's key as text: "42" or "a, b" for a composite key; row-hash keys pass through. */
export function keyLabel(row: DiffRow): string {
  return Array.isArray(row.k) ? row.k.map((part) => JSON.stringify(part)).join(", ") : row.k;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "request failed";
}

export function createDiffsPresenter(slug: () => string): DiffsPresenter {
  const diffs = createRefreshable(() => diffsModel.list(slug()));
  const states = createRefreshable(() => statesModel.list(slug(), false));
  const [creating, setCreating] = createSignal(false);
  const [draft, setDraftSignal] = createSignal<DiffDraft>({ base_state_id: "", target: LIVE });
  const [error, setError] = createSignal<string | null>(null);
  const [detail, setDetail] = createSignal<Diff | null>(null);
  const [rows, setRows] =
    createSignal<DiffsPresenter["rows"] extends () => infer T ? T : never>(null);
  return {
    ...diffs,
    states,
    creating,
    draft,
    error,
    detail,
    rows,
    openCreate: () => {
      setDraftSignal({ base_state_id: "", target: LIVE });
      setError(null);
      setCreating(true);
    },
    openDetail: (diff) => {
      const staticSlug = slug();
      return attempt(async () => {
        setDetail(await diffsModel.get(staticSlug, diff.id));
      });
    },
    openRows: (target, op = "") => {
      const staticSlug = slug();
      return attempt(async () => {
        const query = { adapter_id: target.adapter_id, table: target.table };
        const page = await diffsModel.rows(
          staticSlug,
          target.diff.id,
          op === "" ? query : { ...query, op }
        );
        setRows({ target, page, op });
      });
    },
    close: () => {
      setCreating(false);
      setDetail(null);
      setRows(null);
      setError(null);
    },
    closeRows: () => setRows(null),
    setDraft: (patch) => setDraftSignal((current) => ({ ...current, ...patch })),
    create: async () => {
      const staticSlug = slug();
      const staticBody = toCreateBody(draft());
      setError(null);
      try {
        const { diff, job } = await diffsModel.create(staticSlug, staticBody);
        setCreating(false);
        diffs.refresh();
        showToast(`Comparing ${diff.base.name} with ${targetLabel(diff.target)}`, "info");
        followJob(job, () => diffs.refresh());
      } catch (cause: unknown) {
        setError(messageOf(cause));
      }
    },
    remove: (diff) => {
      const staticSlug = slug();
      return attempt(async () => {
        await diffsModel.remove(staticSlug, diff.id);
        diffs.refresh();
      });
    },
    exportUrl: (diff, format) => diffsModel.exportUrl(slug(), diff.id, format),
  };
}
