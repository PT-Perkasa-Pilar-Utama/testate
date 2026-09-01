import { createSignal } from "solid-js";
import type { Diff, DiffRow, DiffTable, JsonValue } from "@testate/shared";

import { attempt } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { diffsModel } from "../diffs/diffs.model.ts";
import type { DiffRowsPage } from "../diffs/diffs.model.ts";

/** One table of one adapter: what the left rail selects and the panes then show. */
export type Target = { adapter_id: string; adapter_name: string; table: DiffTable };

export type Op = DiffRow["op"] | "";

/** One column's two values, already parsed by `diffRowSchema` on the way in. */
export type CellPair = { column: string; before: JsonValue; after: JsonValue };

export type DiffPresenter = {
  diff: Refreshable<Diff>;
  target: () => Target | null;
  select: (target: Target) => Promise<void>;
  op: () => Op;
  setOp: (op: Op) => Promise<void>;
  page: () => DiffRowsPage | null;
  busy: () => boolean;
  /** The value comparison open over the panes, or null. */
  cell: () => CellPair | null;
  openCell: (pair: CellPair) => void;
  closeCell: () => void;
};

export function tableName(table: DiffTable): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

/** "+12 -3 ~48", and nothing at all for a table that did not move. */
export function countsLabel(table: DiffTable): string {
  const parts: string[] = [];
  if (table.added > 0) parts.push(`+${table.added}`);
  if (table.removed > 0) parts.push(`-${table.removed}`);
  if (table.changed > 0) parts.push(`~${table.changed}`);
  return parts.join(" ");
}

/** Every column either side mentions, in the order the rows list them. */
export function columnsOf(rows: readonly DiffRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const side of [row.before, row.after]) {
      for (const name of Object.keys(side ?? {})) if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

export function createDiffPresenter(slug: () => string, id: () => string): DiffPresenter {
  const [target, setTarget] = createSignal<Target | null>(null);
  const [op, setOpSignal] = createSignal<Op>("");
  const [page, setPage] = createSignal<DiffRowsPage | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [cell, setCell] = createSignal<CellPair | null>(null);
  const diff = createRefreshable(() => diffsModel.get(slug(), id()));
  const load = (staticTarget: Target, staticOp: Op): Promise<void> => {
    const staticSlug = slug();
    const staticId = id();
    setBusy(true);
    return attempt(async () => {
      const query: Parameters<typeof diffsModel.rows>[2] = {
        adapter_id: staticTarget.adapter_id,
        table: tableName(staticTarget.table),
      };
      if (staticOp !== "") query.op = staticOp;
      try {
        setPage(await diffsModel.rows(staticSlug, staticId, query));
      } finally {
        setBusy(false);
      }
    });
  };
  return {
    diff,
    target,
    op,
    page,
    busy,
    cell,
    select: (next) => {
      setTarget(next);
      setCell(null);
      return load(next, op());
    },
    setOp: (next) => {
      const staticTarget = target();
      setOpSignal(next);
      setCell(null);
      return staticTarget === null ? Promise.resolve() : load(staticTarget, next);
    },
    openCell: (pair) => setCell(pair),
    closeCell: () => setCell(null),
  };
}
