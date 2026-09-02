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
 * Asks a list again, every `everyMs`, for as long as it holds work that has not finished.
 *
 * A screen that starts a job follows that job's own event stream. A list does not: open Activity
 * while a diff someone started on another tab is still running and the row says "Running" until
 * the page is reloaded, because nothing on that screen ever asks again. A row carries no job id
 * to subscribe to, so the list asks.
 *
 * It stops the moment nothing is busy, which is what keeps this from being a poll on every screen
 * that shows a list.
 *
 * Its check is `@story-88` in `e2e/states.e2e.ts`, which compares a state with the live databases
 * on one tab and reads the result on another. `onSettled` is checked by `@story-152` there, which
 * watches a checkout finish on Activity and expects the header to say where HEAD went. There is no unit test because there cannot be one:
 * `bun test` resolves Solid's server build, where an effect never runs at all.
 */
export function refreshWhileBusy(
  busy: () => boolean,
  refreshList: () => void,
  onSettled: () => void = () => undefined,
  everyMs = 2_000
): void {
  let wasBusy = false;
  // An interval, not a chain of timeouts. `createEffect` re-runs its effect when the computed
  // value changes, and "still running" does not change, so a timeout set here would have fired
  // exactly once and the row would have gone on saying Running. The effect re-runs when the work
  // finishes, and the cleanup of the busy run is what stops the interval.
  createEffect(busy, (isBusy) => {
    if (!isBusy) {
      // The rows went from running to done, and what they did is the project header's to show: a
      // checkout moved HEAD, a diff of HEAD against live settled whether it is modified. The screen
      // that started the job follows it and tells the header itself; a list watching someone
      // else's job is the only one that knows the moment. A microtask, because the refresh writes
      // signals and an effect callback is not the place to start a flush.
      if (wasBusy) queueMicrotask(onSettled);
      wasBusy = false;
      return undefined;
    }
    wasBusy = true;
    const timer = setInterval(refreshList, everyMs);
    // Returned, not `onCleanup`. A Solid 2 effect body runs with no owner, so an `onCleanup`
    // registered in one is never run and the interval outlives the screen; the effect's own
    // return value is the disposal the next run and the teardown both call.
    return () => clearInterval(timer);
  });
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
