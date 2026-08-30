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
};

const EMPTY: AuditFilter = { action: "", actor: "", outcome: "" };

/**
 * The API has taken action, actor, outcome and a cursor since it was written; the screen sent none
 * of them and rendered every row it was given in one unbounded list.
 */
export function createAuditPresenter(): AuditPresenter {
  const [filter, setFilterSignal] = createSignal<AuditFilter>(EMPTY);
  const rows = createPaged((cursor) => auditModel.page(filter(), cursor));
  return {
    ...rows,
    filter,
    setFilter: (patch) => setFilterSignal((current) => ({ ...current, ...patch })),
  };
}
