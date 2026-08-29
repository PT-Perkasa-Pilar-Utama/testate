import { createMemo, createSignal } from "solid-js";

export type Refreshable<T> = { value: () => T; refresh: () => void };
export type Page<T> = { data: T[]; next: string | null };
export type Paged<T> = Refreshable<T[]> & { hasMore: () => boolean; loadMore: () => Promise<void> };

/**
 * An async memo with a manual refresh. `load` runs inside the memo, so every signal or prop
 * it reads re-runs it; views read `value()` under `<Loading>` and `<Errored>`.
 */
export function createRefreshable<T>(load: () => Promise<T>): Refreshable<T> {
  const [version, bump] = createSignal(0);
  const value = createMemo(async (): Promise<T> => {
    version();
    return load();
  });
  return { value, refresh: () => bump((n) => n + 1) };
}

/**
 * A list that grows page by page: the first page reloads with `refresh`, later pages append until
 * the API answers without a cursor. Extra pages are dropped on refresh so a filter change starts over.
 */
export function createPaged<T>(load: (cursor: string | undefined) => Promise<Page<T>>): Paged<T> {
  const first = createRefreshable(() => load(undefined));
  const [extra, setExtra] = createSignal<T[]>([]);
  const [next, setNext] = createSignal<string | null | undefined>(undefined);
  const cursor = (): string | null =>
    next() === undefined ? first.value().next : (next() ?? null);
  return {
    value: () => [...first.value().data, ...extra()],
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
