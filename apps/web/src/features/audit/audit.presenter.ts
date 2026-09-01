import { createSignal } from "solid-js";
import type { AuditRow } from "@testate/shared";

import { createPaged } from "@/lib/async.ts";
import type { Paged } from "@/lib/async.ts";
import { auditModel } from "./audit.model.ts";
import type { AuditFilter } from "./audit.model.ts";

export const OUTCOMES = ["", "succeeded", "failed", "partial"] as const;

export type AuditPresenter = Paged<AuditRow> & {
  filter: () => AuditFilter;
  setFilter: (patch: Partial<AuditFilter>) => void;
  /** Back to no filter at all, for the one-click way out of a filtered view with nothing in it. */
  clearFilter: () => void;
};

const EMPTY: AuditFilter = { action: "", actor: "", outcome: "", from: "", to: "" };

/**
 * The API has taken action, actor, outcome and a cursor since it was written; the screen sent none
 * of them and rendered every row it was given in one unbounded list.
 */
export function createAuditPresenter(): AuditPresenter {
  const [filter, setFilterSignal] = createSignal<AuditFilter>(EMPTY);
  // Keyed on the filter, or a page appended under the old one survives a filter change: without
  // this, `createPaged` never sees the question changed and never drops those stale extra pages.
  const rows = createPaged(
    (cursor) => auditModel.page(filter(), cursor),
    () => JSON.stringify(filter())
  );
  return {
    ...rows,
    filter,
    setFilter: (patch) => setFilterSignal((current) => ({ ...current, ...patch })),
    clearFilter: () => setFilterSignal(EMPTY),
  };
}
