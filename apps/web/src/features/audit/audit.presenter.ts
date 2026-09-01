import { createSignal } from "solid-js";
import type { AuditRow } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import { auditModel } from "./audit.model.ts";
import type { AuditFilter } from "./audit.model.ts";

export const OUTCOMES = ["", "succeeded", "failed", "partial"] as const;

export type AuditPresenter = {
  rows: () => AuditRow[];
  total: () => number | null;
  refresh: () => void;
  filter: () => AuditFilter;
  setFilter: (patch: Partial<AuditFilter>) => void;
  /** Back to no filter at all, for the one-click way out of a filtered view with nothing in it. */
  clearFilter: () => void;
  /** How many pages back you are; 0 is the first, which is what disables "Previous". */
  depth: () => number;
  hasNext: () => boolean;
  next: () => void;
  previous: () => void;
};

const EMPTY: AuditFilter = { q: "", action: "", actor: "", outcome: "", from: "", to: "" };

/**
 * A log you page through rather than accumulate.
 *
 * "Load more" grew one list until the browser held every row anyone had ever asked for, which is
 * the wrong shape for a log: you read a page, then the one before it. The cursors you have already
 * used are the way back, because a keyset cursor only points forwards. Storage does the same.
 */
export function createAuditPresenter(): AuditPresenter {
  const [filter, setFilterSignal] = createSignal<AuditFilter>(EMPTY);
  const [cursors, setCursors] = createSignal<string[]>([]);
  const page = createRefreshable(() => auditModel.page(filter(), cursors().at(-1)));
  // Changing the question puts you back on its first page: the cursors in hand answer the old one.
  const narrow = (change: () => void): void => {
    setCursors([]);
    change();
  };
  return {
    rows: () => page.value().data,
    total: () => page.value().total,
    refresh: page.refresh,
    filter,
    setFilter: (patch) => narrow(() => setFilterSignal((current) => ({ ...current, ...patch }))),
    clearFilter: () => narrow(() => setFilterSignal(EMPTY)),
    depth: () => cursors().length,
    hasNext: () => page.value().next !== null,
    next: () => {
      const cursor = page.value().next;
      if (cursor !== null) setCursors((current) => [...current, cursor]);
    },
    previous: () => setCursors((current) => current.slice(0, -1)),
  };
}
