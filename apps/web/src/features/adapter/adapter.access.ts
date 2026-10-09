import type { Actor, Adapter } from "@testate/shared";

/** In Inspect only the adapter's creator or an admin may edit or delete it (#56, Q3b). */
export function mayManage(
  adapter: Pick<Adapter, "created_by">,
  inspect: boolean,
  actor: Actor | null
): boolean {
  if (actor === null) return false;
  if (!inspect || actor.role === "admin") return true;
  return actor.kind === "user" && adapter.created_by === actor.id;
}
