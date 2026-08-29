/**
 * Decoded rows per content-addressed blob, kept in memory up to `maxRows` in total and evicted
 * least-recently-used. A blob hash never changes meaning, so an entry never goes stale.
 */
export type RowsCache<T> = {
  get: (hash: string) => T[] | undefined;
  put: (hash: string, rows: T[]) => void;
  size: () => number;
};

export function createRowsCache<T>(maxRows: number): RowsCache<T> {
  const entries = new Map<string, T[]>();
  let total = 0;
  return {
    get: (hash) => {
      const rows = entries.get(hash);
      if (rows === undefined) return undefined;
      entries.delete(hash);
      entries.set(hash, rows);
      return rows;
    },
    put: (hash, rows) => {
      if (rows.length > maxRows || entries.has(hash)) return;
      entries.set(hash, rows);
      total += rows.length;
      for (const [oldest, old] of entries) {
        if (total <= maxRows) break;
        entries.delete(oldest);
        total -= old.length;
      }
    },
    size: () => total,
  };
}
