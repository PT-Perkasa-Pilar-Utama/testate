const WINDOW_MS = 60_000;

export type RateLimiter = {
  /** Seconds to wait when the key's budget is spent, or null when the call is allowed. */
  hit: (key: string, perMinute: number) => number | null;
  /** The same answer as `hit` without spending any budget. */
  over: (key: string, perMinute: number) => number | null;
  /** Spends one unit of the key's budget. */
  record: (key: string) => void;
  /** How many keys are being tracked. Only the sweep's own test needs this. */
  size: () => number;
};

/**
 * A sliding one-minute window per key.
 *
 * The sweep is the reason this is not just a Map. A key's stamps are pruned when that key is hit
 * again, which is enough while keys are finite and issued by an admin, as API tokens and agent
 * tokens are. Login is keyed by client address on an unauthenticated route, so a caller that
 * rotates its source address would otherwise grow this map without limit and never come back to
 * let any entry be pruned. Once a window has passed, every key whose newest stamp is older than
 * the window is dropped.
 */
export function createRateLimiter(now: () => Date): RateLimiter {
  const calls = new Map<string, number[]>();
  let sweptAt = 0;

  const sweep = (at: number): void => {
    if (at - sweptAt < WINDOW_MS) return;
    sweptAt = at;
    for (const [key, stamps] of calls) {
      const newest = stamps[stamps.length - 1];
      if (newest === undefined || at - newest >= WINDOW_MS) calls.delete(key);
    }
  };

  /**
   * The key's stamps inside the window, pruned and stored on the way past. Every entry point goes
   * through here, so the sweep runs whether a caller is asking or recording: a path that only ever
   * records would otherwise never sweep, and the login path only records on a failure.
   */
  const recentAt = (key: string, at: number): number[] => {
    sweep(at);
    const recent = (calls.get(key) ?? []).filter((stamp) => at - stamp < WINDOW_MS);
    calls.set(key, recent);
    return recent;
  };

  const over = (key: string, perMinute: number): number | null => {
    const at = now().getTime();
    const recent = recentAt(key, at);
    if (recent.length < perMinute) return null;
    return Math.ceil((WINDOW_MS - (at - (recent[0] ?? at))) / 1000);
  };

  const record = (key: string): void => {
    const at = now().getTime();
    recentAt(key, at).push(at);
  };

  return {
    over,
    record,
    hit: (key, perMinute) => {
      const wait = over(key, perMinute);
      if (wait === null) record(key);
      return wait;
    },
    size: () => calls.size,
  };
}
