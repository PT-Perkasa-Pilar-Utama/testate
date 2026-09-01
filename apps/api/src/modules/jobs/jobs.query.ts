import { keysetCondition } from "../../lib/db/keyset.ts";
import type { Keyset } from "../../lib/db/keyset.ts";
import { likeTerm } from "../../lib/db/like.ts";
import type { JobSort, JobsListQuery } from "./jobs.repository.ts";

/** How a jobs listing turns into SQL: which column it orders by, and what it narrows to. */
type Condition = { sql: string; params: string[] };
/** Only these, and only through the map: a sort arriving as text never reaches the SQL. */
const SORT_COLUMNS = {
  created_at: "j.created_at",
  kind: "j.kind",
  status: "j.status",
} as const satisfies Record<JobSort, string>;

/** The keyset for one ordering, shared with the cursor so a cursor cannot outlive its sort. */
export function keysetOf(query: JobsListQuery): Keyset {
  return {
    column: SORT_COLUMNS[query.sort],
    id: "j.id",
    sort: query.sort,
    order: query.order,
    idOrder: query.order,
  };
}

/** The page's own condition, kept apart from `conditions` so a count never inherits the cursor. */
export function cursorCondition(query: JobsListQuery): Condition | null {
  const after = keysetCondition(keysetOf(query), query.cursor);
  return after === null ? null : { sql: after.sql, params: after.params.map(String) };
}

export function conditions(query: JobsListQuery): Condition[] {
  const found: Condition[] = [];
  if (query.scope !== null) {
    const marks = query.scope.map(() => "?").join(",");
    const own = `j.project_id IN (${marks === "" ? "NULL" : marks})`;
    found.push({
      sql: query.includeInstance ? `(${own} OR j.project_id IS NULL)` : own,
      params: query.scope,
    });
  } else if (!query.includeInstance) {
    found.push({ sql: "j.project_id IS NOT NULL", params: [] });
  }
  for (const key of ["project_id", "kind", "status"] as const) {
    const value = query[key];
    if (value !== undefined) found.push({ sql: `j.${key} = ?`, params: [value] });
  }
  if (query.adapter_id !== undefined) {
    found.push({ sql: "j.adapter_ids LIKE ?", params: [`%"${query.adapter_id}"%`] });
  }
  if (query.q !== undefined && query.q !== "") {
    const like = likeTerm(query.q);
    // `actor` is the JSON the row was written with, and the name a person searches for is in it.
    found.push({
      sql: `(j.kind LIKE ? ESCAPE '\\' OR j.status LIKE ? ESCAPE '\\' OR j.actor LIKE ? ESCAPE '\\')`,
      params: [like, like, like],
    });
  }
  return found;
}
