const WINDOW_MS = 60_000;

/** A sliding one-minute window per key; returns the seconds to wait when the budget is spent. */
export function createRateLimiter(
  now: () => Date
): (tokenId: string, perMinute: number) => number | null {
  const calls = new Map<string, number[]>();
  return (tokenId, perMinute) => {
    const at = now().getTime();
    const recent = (calls.get(tokenId) ?? []).filter((stamp) => at - stamp < WINDOW_MS);
    if (recent.length >= perMinute) {
      calls.set(tokenId, recent);
      return Math.ceil((WINDOW_MS - (at - (recent[0] ?? at))) / 1000);
    }
    recent.push(at);
    calls.set(tokenId, recent);
    return null;
  };
}
