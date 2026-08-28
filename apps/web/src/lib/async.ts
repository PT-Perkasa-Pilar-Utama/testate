import { createMemo, createSignal } from "solid-js";

export type Refreshable<T> = { value: () => T; refresh: () => void };

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
