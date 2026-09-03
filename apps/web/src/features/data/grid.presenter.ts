import { createMemo, createSignal } from "solid-js";
import type { Adapter, JsonValue, RowsPage, TableSchema } from "@testate/shared";
import * as v from "valibot";

import { plain } from "../../lib/plain-value.ts";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { dataModel } from "./data.model.ts";
import { createEditingPresenter } from "./editing.presenter.ts";
import type { EditingPresenter } from "./editing.presenter.ts";
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
  adapter: Refreshable<Adapter>;
  /** The table's schema from the adapter's introspection; null until it loads or when unknown. */
  table: () => TableSchema | null;
  editing: EditingPresenter;
  /** Editing needs qa, a sandbox database adapter on the Tabular tier, and a primary key. */
  editable: () => boolean;
  /** Why `editable` is false right now, so the write-mode switch can say why next to itself. */
  editableReason: () => string | null;
  sort: () => string | undefined;
  order: () => "asc" | "desc";
  toggleSort: (column: string) => void;
  filters: () => Filter[];
  /** A download link for what is on screen, filters and sort included. */
  exportUrl: (format: "csv" | "json") => string;
  addFilter: (filter: Filter) => void;
  removeFilter: (index: number) => void;
  limit: () => PageSize;
  setLimit: (limit: PageSize) => void;
  /** The cursors behind the current page, so "previous" replays the one before. */
  depth: () => number;
  next: () => void;
  previous: () => void;
  first: () => void;
  /** The linked grid for an FK cell, or null for a plain cell (story 140). */
  linkFor: (column: string, value: JsonValue) => string | null;
  /** Every table or collection of the adapter, so a browser can move between them. */
  collections: () => string[];
};

/**
 * Which columns are numbers, and so line up on the right. Postgres, MySQL and MongoDB each spell
 * the same idea differently ("int4", "int(11)", "long"), and they all match this.
 */
export const NUMERIC_TYPE = /int|serial|numeric|decimal|float|double|real|money|long/i;

/**
 * Whether an operator needs a value. `null` and `notnull` do not; every other one does, and the
 * API refuses a valueless filter outright (`parseFilter`, data.handler.ts). The form has to know
 * the same rule, or pressing Add filter on an empty box throws the whole grid into its error
 * boundary instead of saying what is missing.
 */
export function filterNeedsValue(op: FilterOp): boolean {
  return op !== "null" && op !== "notnull";
}

/** `<column>:<op>:<value>` as 06 §6.2 reads it; the value may hold colons. */
export function filterText(filter: Filter): string {
  return `${filter.column}:${filter.op}:${filter.value}`;
}

/**
 * A cell for the grid: strings raw, everything else as JSON, null as the word. A document
 * store's Extended JSON is unwrapped first, so an id reads as its hex and a number as digits.
 */
export function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "NULL";
  const shown = plain(value);
  return v.is(v.string(), shown) ? shown : JSON.stringify(shown);
}

export function qualifiedName(table: { schema: string | null; name: string }): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

/** `<column>:<op>:<value>` back into a filter; null when the operator is unknown. */
export function parseFilterText(text: string): Filter | null {
  const [column, op, ...rest] = text.split(":");
  const found = FILTER_OPS.find((candidate) => candidate === op);
  if (column === undefined || column === "" || found === undefined) return null;
  return { column, op: found, value: rest.join(":") };
}

/** Filters carried in the URL (`?filter=col:op:value`), as an FK link sets them (story 140). */
export function filtersFromSearch(search: string): Filter[] {
  return new URLSearchParams(search)
    .getAll("filter")
    .map(parseFilterText)
    .filter((filter): filter is Filter => filter !== null);
}

/** The grid path of the table an FK column points at, filtered to the referenced row. */
export function fkLink(
  slug: string,
  id: string,
  table: TableSchema | null,
  column: string,
  value: JsonValue
): string | null {
  const fk = table?.foreign_keys_out.find(
    (item) => item.columns.length === 1 && item.columns[0] === column
  );
  const refColumn = fk?.ref_columns[0];
  if (fk === undefined || refColumn === undefined || value === null) return null;
  // An FK holding an empty string renders as nothing, and a filter with no value is refused by
  // the API. A cell that cannot make a working link is not a link.
  const text = cellText(value);
  if (text === "") return null;
  const filter = filterText({ column: refColumn, op: "eq", value: text });
  return `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}/tables/${encodeURIComponent(qualifiedName(fk.ref))}?filter=${encodeURIComponent(filter)}`;
}

export function createGridPresenter(
  slug: () => string,
  id: () => string,
  table_: () => string
): GridPresenter {
  const [sort, setSort] = createSignal<string | undefined>(undefined);
  const [order, setOrder] = createSignal<"asc" | "desc">("asc");
  // Read once, at build. `app.tsx` keys this route on the table and the query, so a link to
  // another table builds a new presenter rather than writing over this one's signals from an
  // effect. That effect fed the same signals the row query reads, which is the shape the
  // scheduler is worst at.
  const [filters, setFilters] = createSignal<Filter[]>(filtersFromSearch(window.location.search));
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
    return dataModel.rows(slug(), id(), table_(), query);
  });
  const reset = (): void => {
    setCursors([]);
  };
  const adapter = createRefreshable(() => adaptersModel.get(slug(), id()));
  const schema = createRefreshable(() => adapterModel.schema(slug(), id()));
  const table = createMemo((): TableSchema | null => {
    const wanted = table_();
    return schema.value().tables.find((item) => qualifiedName(item) === wanted) ?? null;
  });
  const editing = createEditingPresenter(slug, id, table_, table, () => page.refresh());
  /** The one reason, in order, that editing is off; null once every condition is met. */
  const editableReason = (): string | null => {
    const current = adapter.value();
    if (current.tier !== "tabular") return "Editing needs the Tabular tier.";
    if (current.mode !== "sandbox") return "Editing needs sandbox mode; this adapter is read-only.";
    if ((table()?.primary_key?.length ?? 0) === 0)
      return "This table has no primary key, so a row can't be targeted for edits.";
    return null;
  };
  const exportUrl = (format: "csv" | "json"): string => {
    const query = { order: order(), filter: filters().map(filterText) };
    const sorted = sort();
    return dataModel.tableExportUrl(
      slug(),
      id(),
      table_(),
      sorted === undefined ? query : { ...query, sort: sorted },
      format
    );
  };
  return {
    page,
    adapter,
    table,
    collections: () => schema.value().tables.map(qualifiedName),
    exportUrl,
    editing,
    editable: () => editableReason() === null,
    editableReason,
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
    linkFor: (column, value) => fkLink(slug(), id(), table(), column, value),
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
