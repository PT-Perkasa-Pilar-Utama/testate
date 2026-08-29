import { createSignal } from "solid-js";
import type { JsonValue, RowsPage } from "@testate/shared";
import * as v from "valibot";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { dataModel } from "./data.model.ts";
import type { RowsQuery } from "./data.model.ts";

export const FILTER_OPS = [
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "like",
  "in",
  "null",
  "notnull",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export type Filter = { column: string; op: FilterOp; value: string };

export const PAGE_SIZES = ["25", "100", "500"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type GridPresenter = {
  page: Refreshable<RowsPage>;
  sort: () => string | undefined;
  order: () => "asc" | "desc";
  toggleSort: (column: string) => void;
  filters: () => Filter[];
  addFilter: (filter: Filter) => void;
  removeFilter: (index: number) => void;
  limit: () => PageSize;
  setLimit: (limit: PageSize) => void;
  /** The cursors behind the current page, so "previous" replays the one before. */
  depth: () => number;
  next: () => void;
  previous: () => void;
  first: () => void;
};

/** `<column>:<op>:<value>` as 06 §6.2 reads it; the value may hold colons. */
export function filterText(filter: Filter): string {
  return `${filter.column}:${filter.op}:${filter.value}`;
}

/** A cell for the grid: strings raw, everything else as JSON, null as the word. */
export function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "NULL";
  return v.is(v.string(), value) ? value : JSON.stringify(value);
}

export function createGridPresenter(
  slug: () => string,
  id: () => string,
  table: () => string
): GridPresenter {
  const [sort, setSort] = createSignal<string | undefined>(undefined);
  const [order, setOrder] = createSignal<"asc" | "desc">("asc");
  const [filters, setFilters] = createSignal<Filter[]>([]);
  const [limit, setLimitSignal] = createSignal<PageSize>("100");
  const [cursors, setCursors] = createSignal<string[]>([]);
  const page = createRefreshable(() => {
    const query: RowsQuery = {
      limit: Number(limit()),
      order: order(),
      filter: filters().map(filterText),
    };
    const cursor = cursors().at(-1);
    const sorted = sort();
    if (cursor !== undefined) query.cursor = cursor;
    if (sorted !== undefined) query.sort = sorted;
    return dataModel.rows(slug(), id(), table(), query);
  });
  const reset = (): void => {
    setCursors([]);
  };
  return {
    page,
    sort,
    order,
    toggleSort: (column) => {
      if (sort() === column) setOrder((current) => (current === "asc" ? "desc" : "asc"));
      else {
        setSort(column);
        setOrder("asc");
      }
      reset();
    },
    filters,
    addFilter: (filter) => {
      setFilters((current) => [...current, filter]);
      reset();
    },
    removeFilter: (index) => {
      setFilters((current) => current.filter((_item, position) => position !== index));
      reset();
    },
    limit,
    setLimit: (next) => {
      setLimitSignal(next);
      reset();
    },
    depth: () => cursors().length,
    next: () => {
      const cursor = page.value().page.next_cursor;
      if (cursor !== null) setCursors((current) => [...current, cursor]);
    },
    previous: () => setCursors((current) => current.slice(0, -1)),
    first: reset,
  };
}
