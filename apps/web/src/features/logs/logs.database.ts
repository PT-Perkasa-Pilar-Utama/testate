import * as v from "valibot";
import type { Adapter } from "@testate/shared";
import { SERVER_LOG_GRANTS, SERVER_LOG_LABEL } from "@testate/shared";

/** Which part of a database adapter's page opens: a run link names a source (#84, D5). */
export function sectionFrom(search: string): "data" | "logs" {
  return new URLSearchParams(search).has("source") ? "logs" : "data";
}

export type MissingSource = { label: string; grant: string };

const GRANTS = new Map<string, readonly (readonly [string, string])[]>(
  Object.entries(SERVER_LOG_GRANTS).map(([engine, grants]) => [engine, Object.entries(grants)])
);
const LABELS = new Map<string, string>(Object.entries(SERVER_LOG_LABEL));

/** A source's name as a person reads it: "Statements", "Server log"; any other name as it is. */
export const labelOf = (source: string): string => LABELS.get(source) ?? source;

/**
 * The engine's server-log sources this credential cannot read, each with what opens it (D3), the
 * grant naming the adapter's own database user when its config says who that is.
 */
export function missingSources(
  adapter: Pick<Adapter, "engine" | "config">,
  readable: readonly string[]
): MissingSource[] {
  const user = v.safeParse(v.string(), new Map(Object.entries(adapter.config)).get("user"));
  const who = user.success ? user.output : "<user>";
  return (GRANTS.get(adapter.engine) ?? [])
    .filter(([source]) => !readable.includes(source))
    .map(([source, grant]) => ({ label: labelOf(source), grant: grant.replaceAll("<user>", who) }));
}
