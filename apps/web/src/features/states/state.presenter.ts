import { createSignal } from "solid-js";
import type { Head, ManifestTable, State, StateDetail } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { projectsModel } from "../projects/projects.model.ts";
import { matchingTables } from "./states.format.ts";
import { statesModel } from "./states.model.ts";

export type DetailAdapter = StateDetail["adapters"][number];
export type TableSort = "name" | "rows";

export type StatePresenter = {
  detail: Refreshable<StateDetail>;
  /** The project's HEAD, so the page can say whether the databases are on this state. */
  head: Refreshable<Head>;
  /** The parent, by name; null for a root, or for a parent that is gone. */
  parent: Refreshable<State | null>;
  /** The database the rail has picked; the first one until a click says otherwise. */
  picked: () => DetailAdapter | null;
  pick: (adapterId: string) => void;
  needle: () => string;
  setNeedle: (text: string) => void;
  sort: () => TableSort;
  setSort: (sort: TableSort) => void;
  /** The picked database's tables, searched and sorted. */
  tables: () => ManifestTable[];
  isHead: () => boolean;
  refresh: () => void;
};

export function qualifiedTable(table: { schema: string | null; name: string }): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

/** By name, or the biggest first; a tie on rows falls back to the name so the order is stable. */
export function sortTables(tables: readonly ManifestTable[], sort: TableSort): ManifestTable[] {
  const byName = (a: ManifestTable, b: ManifestTable): number =>
    qualifiedTable(a).localeCompare(qualifiedTable(b));
  return [...tables].sort((a, b) =>
    sort === "rows" ? b.rows - a.rows || byName(a, b) : byName(a, b)
  );
}

/** A database's trouble, for the rail's mark: read at different moments, or a warning on a table. */
export function troubled(adapter: DetailAdapter): boolean {
  return adapter.consistency === "best_effort" || adapter.warnings.length > 0;
}

/** `?db=` and `?q=` name the picked database and the search, so a link lands on a table. */
function fromSearch(search: string) {
  const params = new URLSearchParams(search);
  return { db: params.get("db"), q: params.get("q") ?? "" };
}

function toSearch(db: string | null, q: string): string {
  const params = new URLSearchParams();
  if (db !== null) params.set("db", db);
  if (q !== "") params.set("q", q);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export function createStatePresenter(slug: () => string, id: () => string): StatePresenter {
  const detail = createRefreshable(() => statesModel.get(slug(), id()));
  const head = createRefreshable(async () => (await projectsModel.overview(slug())).project.head);
  const parent = createRefreshable(async (): Promise<State | null> => {
    const parentId = detail.value().parent_state_id;
    if (parentId === null) return null;
    try {
      return await statesModel.get(slug(), parentId);
    } catch {
      return null;
    }
  });
  // Read once, at build: the address is where a pasted link keeps its database and search.
  const initial = fromSearch(window.location.search);
  const [pickedId, setPickedId] = createSignal<string | null>(initial.db);
  const [needle, setNeedleSignal] = createSignal(initial.q);
  const [sort, setSort] = createSignal<TableSort>("name");
  const remember = (db: string | null, q: string): void => {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${toSearch(db, q)}`
    );
  };
  const picked = (): DetailAdapter | null => {
    const adapters = detail.value().adapters;
    return adapters.find((adapter) => adapter.adapter_id === pickedId()) ?? adapters[0] ?? null;
  };
  return {
    detail,
    head,
    parent,
    picked,
    pick: (adapterId) => {
      setPickedId(adapterId);
      remember(adapterId, needle());
    },
    needle,
    setNeedle: (text) => {
      setNeedleSignal(text);
      remember(pickedId(), text);
    },
    sort,
    setSort,
    tables: () => {
      const adapter = picked();
      return adapter === null ? [] : sortTables(matchingTables(adapter.tables, needle()), sort());
    },
    isHead: () => head.value().state_id === id(),
    refresh: () => {
      detail.refresh();
      head.refresh();
    },
  };
}
