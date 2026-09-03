/**
 * A per-browser preference: the tab, view or chip a person left a screen on, so the screen
 * reopens there. Never anything that must persist: storage can be empty, blocked or throw
 * (a private window, cleared site data), and every read falls back to the default.
 */
export function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = window.localStorage.getItem(`testate.${key}`);
    const found = allowed.find((candidate) => candidate === stored);
    return found ?? fallback;
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(`testate.${key}`, value);
  } catch {
    // A browser that refuses site data still gets a working screen; it just forgets.
  }
}
