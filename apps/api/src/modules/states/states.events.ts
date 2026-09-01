import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

export type StateEvents = { checkouts: number; diffs: number };

/**
 * How many checkouts and diffs each of these states is named by.
 *
 * Two grouped queries rather than one join per row: a state is referenced by `checkouts.state_id`
 * and by either side of a diff, and the second is a union of two columns.
 */
export function eventsOf(db: MetadataDb, stateIds: string[]): Map<string, StateEvents> {
  const counts = new Map<string, { checkouts: number; diffs: number }>();
  if (stateIds.length === 0) return counts;
  const marks = stateIds.map(() => "?").join(", ");
  const bump = (id: string, key: "checkouts" | "diffs", n: number): void => {
    const current = counts.get(id) ?? { checkouts: 0, diffs: 0 };
    counts.set(id, { ...current, [key]: n });
  };
  const countRow = v.object({ state_id: v.string(), n: v.number() });
  for (const row of v.parse(
    v.array(countRow),
    db
      .query(
        `SELECT state_id, COUNT(*) AS n FROM checkouts WHERE state_id IN (${marks}) GROUP BY state_id`
      )
      .all(...stateIds)
  )) {
    bump(row.state_id, "checkouts", row.n);
  }
  for (const row of v.parse(
    v.array(countRow),
    db
      .query(
        `SELECT state_id, COUNT(*) AS n FROM (
           SELECT base_state_id AS state_id FROM diffs WHERE base_state_id IN (${marks})
           UNION ALL
           SELECT target_state_id AS state_id FROM diffs WHERE target_state_id IN (${marks})
         ) GROUP BY state_id`
      )
      .all(...stateIds, ...stateIds)
  )) {
    bump(row.state_id, "diffs", row.n);
  }
  return counts;
}
