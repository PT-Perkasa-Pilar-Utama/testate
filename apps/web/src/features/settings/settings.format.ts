const UNITS: readonly [string, number][] = [
  ["d", 86400],
  ["h", 3600],
  ["m", 60],
];

/** 9057 -> "2h 30m"; the coarsest two units, because a third never changes an admin's read. */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return "just started";
  let remaining = Math.floor(seconds);
  const parts: string[] = [];
  for (const [label, size] of UNITS) {
    const count = Math.floor(remaining / size);
    if (count > 0) {
      parts.push(`${count}${label}`);
      remaining -= count * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}
