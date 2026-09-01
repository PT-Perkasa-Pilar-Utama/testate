import { createEffect, createMemo, createSignal, refresh } from "solid-js";

export type Refreshable<T> = { value: () => T; refresh: () => void };
export type Page<T> = { data: T[]; next: string | null; total: number | null };
export type Paged<T> = Refreshable<T[]> & {
  hasMore: () => boolean;
  loadMore: () => Promise<void>;
  /** How many rows match across every page, null where the endpoint does not count. */
  total: () => number | null;
};

/**
 * An async memo you can ask again. `load` runs inside the memo, so every signal or prop it reads
 * re-runs it; views read `value()` under `<Loading>` and `<Errored>`.
 *
 * `refresh` is Solid's own primitive rather than a counter we bump, and the difference is not
 * tidiness. A counter is an input change, so the memo's next window counts as pending and every
 * `<Loading>` above it flashes its fallback after a save. `refresh()` marks the recompute a re-ask
 * of the same question and the window stays quiet.
 */
export function createRefreshable<T>(load: () => Promise<T>): Refreshable<T> {
  const value = createMemo((): Promise<T> => load());
  return { value, refresh: () => refresh(value) };
}

/**
 * A list that grows page by page: the first page reloads with `refresh`, later pages append until
 * the API answers without a cursor. Extra pages are dropped on refresh so a filter change starts over.
 */
export function createPaged<T>(
  load: (cursor: string | undefined) => Promise<Page<T>>,
  key?: () => string
): Paged<T> {
  const first = createRefreshable(() => load(undefined));
  const [extra, setExtra] = createSignal<T[]>([]);
  const [next, setNext] = createSignal<string | null | undefined>(undefined);
  const cursor = (): string | null =>
    next() === undefined ? first.value().next : (next() ?? null);
  // A memo, not a plain function: a plain one built a new array on every read, so no subscriber's
  // equality gate ever closed and each of them re-ran on every upstream change.
  const value = createMemo(() => [...first.value().data, ...extra()]);
  // A sort or a search sends a different question. The pages already appended answered the old one,
  // so they go: without this, changing the sort leaves the previous order stuck below the new one.
  if (key !== undefined) {
    createEffect(key, () => {
      setExtra([]);
      setNext(undefined);
    });
  }
  return {
    value,
    total: () => first.value().total,
    refresh: () => {
      setExtra([]);
      setNext(undefined);
      first.refresh();
    },
    hasMore: () => cursor() !== null,
    loadMore: async () => {
      const after = cursor();
      if (after === null) return;
      const page = await load(after);
      setExtra((current) => [...current, ...page.data]);
      setNext(page.next);
    },
  };
}
