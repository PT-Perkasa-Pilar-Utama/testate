import type { Adapter, Project } from "@testate/shared";

import { pickerOptions } from "../databases/databases.presenter.ts";
import type { ProjectOption } from "../databases/databases.presenter.ts";

/**
 * Where an adapter may move (#77; M1, M3 of docs/decisions/2026-10-10-move-adapter.md): never its
 * own project. A database joins only a project at its starting point, as on the Databases screen;
 * Inspect stores no pushed logs, so an ingest adapter cannot go there.
 */
export function moveOptions(
  adapter: Pick<Adapter, "kind" | "engine">,
  projects: readonly Project[],
  current: string
): ProjectOption[] {
  const others = projects.filter((project) => project.slug !== current);
  if (adapter.kind === "database") return pickerOptions(others);
  // Storage and logs carry no history: every project takes them, by name.
  const names = new Map(others.map((project) => [project.slug, project.name]));
  return pickerOptions(others).map((option) => {
    const name = names.get(option.value) ?? option.value;
    const refused = adapter.engine === "ingest" && option.inspect;
    return {
      ...option,
      label: refused ? `${name} (stores no pushed logs)` : name,
      disabled: refused,
    };
  });
}

/** A database in a regular project leaves that project's states when it moves (M2, ADR 0005). */
export function leavesHistory(adapter: Pick<Adapter, "kind">, fromInspect: boolean): boolean {
  return adapter.kind === "database" && !fromInspect;
}
