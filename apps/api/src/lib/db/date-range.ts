/**
 * Inclusive day-range conditions for a `created_at`-style column, from an ISO date like
 * "2026-08-30". The upper bound compares against the end of that day (23:59:59.999) instead of
 * its midnight, or a row created any time on the "to" day would compare greater than the bare
 * date string and fall outside the range.
 */
export function createdRangeConditions(
  column: string,
  from: string | undefined,
  to: string | undefined
): { sql: string; params: string[] }[] {
  const found: { sql: string; params: string[] }[] = [];
  if (from !== undefined && from !== "") found.push({ sql: `${column} >= ?`, params: [from] });
  if (to !== undefined && to !== "") {
    found.push({ sql: `${column} <= ?`, params: [`${to}T23:59:59.999Z`] });
  }
  return found;
}
