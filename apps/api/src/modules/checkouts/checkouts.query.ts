import { createdRangeConditions } from "../../lib/db/date-range.ts";
import { likeTerm } from "../../lib/db/like.ts";
import type { CheckoutSort, CheckoutsFilter } from "./checkouts.repository.ts";

/** Only these, and only through the map: a sort arriving as text never reaches the SQL. */
export const SORT_COLUMNS = {
  created_at: "c.created_at",
  state: "s.name COLLATE NOCASE",
  status: "c.status",
  // Whoever ran it is a user or a token, never both; COALESCE reads the one that is there.
  actor: "COALESCE(u.username, t.name) COLLATE NOCASE",
} as const satisfies Record<CheckoutSort, string>;

/** Everything but the cursor: `list` adds that, `total` must not. */
export type ListConditions = { where: string[]; params: (string | number)[] };

/** The joins both the listing and the count need: `q` searches the state and the actor. */
export const FROM = `FROM checkouts c
  LEFT JOIN states s ON s.id = c.state_id
  LEFT JOIN users u ON u.id = c.actor_user_id
  LEFT JOIN api_tokens t ON t.id = c.actor_token_id`;

export function conditions(projectId: string, filter: CheckoutsFilter): ListConditions {
  const where: string[] = ["c.project_id = ?"];
  const params: (string | number)[] = [projectId];
  if (filter.status !== undefined) {
    where.push("c.status = ?");
    params.push(filter.status);
  }
  if (filter.state_id !== undefined) {
    where.push("c.state_id = ?");
    params.push(filter.state_id);
  }
  if (filter.purpose !== undefined) {
    where.push("c.purpose = ?");
    params.push(filter.purpose);
  }
  if (filter.q !== undefined && filter.q !== "") {
    const like = likeTerm(filter.q);
    where.push(
      `(s.name LIKE ? ESCAPE '\\' OR c.status LIKE ? ESCAPE '\\'
        OR COALESCE(u.username, t.name) LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like);
  }
  for (const condition of createdRangeConditions(
    "c.created_at",
    filter.created_from,
    filter.created_to
  )) {
    where.push(condition.sql);
    params.push(...condition.params);
  }
  return { where, params };
}
