import { createMemo, createSignal, onCleanup } from "solid-js";

import type { Query } from "./api-client.ts";

/**
 * Sorting and searching for the tables that list things, in the shape shadcn's data table settled
 * on. It is deliberately not TanStack: that library is Solid 1.x, and this app runs Solid 2.
 *
 * Both work on the rows a screen has loaded, not on the whole list, so a search has to make sure
 * the screen has all of them first (see `createTableView`). The API sorts nothing today; when it
 * does, the same parts sit in front of it and the screens do not change.
 */
export type Direction = "asc" | "desc";
export type SortState<TKey extends string> = { key: TKey; direction: Direction } | null;

/**
 * A column says which of the two it is instead of the sorter guessing from the value: "10" before
 * "9" is right for a name and wrong for a size, and the guess is what gets that backwards.
 */
export type Sorter<TRow> =
  | { text: (row: TRow) => string | null }
  | { number: (row: TRow) => number | null };

/** Nulls last whichever way the column points: "no value" is not a small value. */
function compareText(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  // `numeric` so state 2 comes before state 10, `base` so Ada and ada do not split the list.
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareNumbers(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left - right;
}

export function compareBy<TRow>(sorter: Sorter<TRow>, left: TRow, right: TRow): number {
  if ("number" in sorter) return compareNumbers(sorter.number(left), sorter.number(right));
  return compareText(sorter.text(left), sorter.text(right));
}

/** Click through ascending, descending, and back to the order the API sent. */
export function nextSort<TKey extends string>(
  current: SortState<TKey>,
  key: TKey
): SortState<TKey> {
  if (current === null || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

/** 1 for a row with no value in this column, 0 for one that has it. */
function missing<TRow>(sorter: Sorter<TRow>, row: TRow): number {
  const value = "number" in sorter ? sorter.number(row) : sorter.text(row);
  return value === null ? 1 : 0;
}

export function sortRows<TRow, TKey extends string>(
  rows: TRow[],
  sorters: Record<TKey, Sorter<TRow>>,
  state: SortState<TKey>
): TRow[] {
  if (state === null) return rows;
  const sorter = sorters[state.key];
  const sign = state.direction === "asc" ? 1 : -1;
  // A copy: `sort` is in place, and the array belongs to the memo that loaded it.
  return [...rows].sort((left, right) => {
    // Ranked before the direction is applied, or reversing the column floats the blanks to the top.
    const blanks = missing(sorter, left) - missing(sorter, right);
    if (blanks !== 0) return blanks;
    return sign * compareBy(sorter, left, right);
  });
}

/** Every word has to appear somewhere in the row, so "admin qa" narrows instead of widening. */
export function matchesQuery(fields: (string | null)[], query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return true;
  const haystack = fields
    .filter((field) => field !== null)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Which way one column points, for the header that draws the arrow. */
export function directionOf<TKey extends string>(
  state: SortState<TKey>,
  key: TKey
): Direction | null {
  return state !== null && state.key === key ? state.direction : null;
}

/** The half of a `TableView` a header needs, so the header does not care what the rows are. */
export type SortControl<TKey extends string> = {
  sort: () => SortState<TKey>;
  toggleSort: (key: TKey) => void;
};

export type TableView<TRow, TKey extends string> = SortControl<TKey> & {
  rows: () => TRow[];
  query: () => string;
  setQuery: (value: string) => void;
  /** True while the search is still pulling the rest of the list in behind it. */
  draining: () => boolean;
};

/**
 * Sort and search over one screen's rows.
 *
 * `pager` is what makes the search honest. The list arrives 50 rows at a time, so searching only
 * what is on screen answers "no matches" for a row that is one page away. The first keystroke
 * therefore pulls the rest of the list in, once, and after that the search is over all of it.
 */
export function createTableView<TRow, TKey extends string>(options: {
  rows: () => TRow[];
  sorters: Record<TKey, Sorter<TRow>>;
  fields: (row: TRow) => (string | null)[];
  pager?: { hasMore: () => boolean; loadMore: () => Promise<void> };
}): TableView<TRow, TKey> {
  const [sort, setSort] = createSignal<SortState<TKey>>(null);
  const [query, setQuery] = createSignal("");
  const [draining, setDraining] = createSignal(false);
  let drained = false;
  const drain = async (): Promise<void> => {
    const pager = options.pager;
    if (drained || pager === undefined) return;
    drained = true;
    setDraining(true);
    try {
      while (pager.hasMore()) await pager.loadMore();
    } finally {
      setDraining(false);
    }
  };
  const rows = createMemo((): TRow[] => {
    const found = options.rows().filter((row) => matchesQuery(options.fields(row), query()));
    return sortRows(found, options.sorters, sort());
  });
  return {
    rows,
    sort,
    toggleSort: (key) => setSort((current) => nextSort(current, key)),
    query,
    setQuery: (value) => {
      setQuery(value);
      if (value !== "") void drain();
    },
    draining,
  };
}

/** What a list endpoint takes beyond the page: the order and the search it wants it in. */
export type TableParams<TKey extends string> = {
  sort?: TKey;
  order?: Direction;
  q?: string;
};

/** The query string for one page of a sorted, searched list. `toQuery` drops what is undefined. */
export function tableQuery<TKey extends string>(
  params: TableParams<TKey>,
  cursor: string | undefined
): Query {
  return { cursor, sort: params.sort, order: params.order, q: params.q };
}

export type TableControls<TKey extends string> = SortControl<TKey> & {
  query: () => string;
  setQuery: (value: string) => void;
  /** What the model sends. Read it inside the loader so a change fetches the new answer. */
  params: () => TableParams<TKey>;
  /** Changes whenever the question changes, so `createPaged` drops the pages that answered the old one. */
  key: () => string;
  /** True while what you see still answers the previous keystroke. */
  draining: () => boolean;
};

const TYPING_MS = 250;

/**
 * Sort and search that the API performs.
 *
 * The difference from `createTableView` is what the answer covers: this one orders and searches
 * every row the filter matches, not the page in front of you, which is the only honest way to do it
 * on a list that arrives 50 rows at a time. The typing pause is not cosmetic: without it every
 * keystroke is a request, and a person typing a name would put eight of them on the wire.
 */
export function createTableControls<TKey extends string>(
  debounceMs = TYPING_MS
): TableControls<TKey> {
  const [sort, setSort] = createSignal<SortState<TKey>>(null);
  const [typed, setTyped] = createSignal("");
  const [settled, setSettled] = createSignal("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const params = (): TableParams<TKey> => {
    const current = sort();
    const search = settled().trim();
    const built: TableParams<TKey> = {};
    if (current !== null) {
      built.sort = current.key;
      built.order = current.direction;
    }
    if (search !== "") built.q = search;
    return built;
  };
  return {
    sort,
    toggleSort: (key) => setSort((current) => nextSort(current, key)),
    query: typed,
    setQuery: (value) => {
      setTyped(value);
      clearTimeout(timer);
      timer = setTimeout(() => setSettled(value), debounceMs);
    },
    params,
    key: () => JSON.stringify(params()),
    draining: () => typed().trim() !== settled().trim(),
  };
}
