import { createMemo, createSignal } from "solid-js";
import type { AdapterWithProject, Head, Project } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import {
  ADAPTER_MODE_LABEL,
  ADAPTER_STATUS_LABEL,
  DATABASE_ENGINE_OPTIONS,
  ENGINE_LABEL,
  TIER_LABEL,
} from "@/lib/labels.ts";
import { activeFilterCount, createTableView } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import { ADAPTER_FILTERS_EMPTY, matchesAdapterFilters } from "../adapters/adapters.fields.ts";
import type { AdapterFilters } from "../adapters/adapters.fields.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import type { AdapterSort } from "../adapters/adapters.presenter.ts";
import { projectsModel } from "../projects/projects.model.ts";

/**
 * The Databases screen: every database in scope, grouped by project, Inspect first (a tier is a
 * menu, docs/decisions/2026-10-10-databases-menu.md).
 */
export type DatabaseGroup = {
  slug: string;
  name: string;
  inspect: boolean;
  /** Whether a database may join this project right now (Q2). */
  atStart: boolean;
  rows: AdapterWithProject[];
};

export type ProjectOption = { value: string; label: string; inspect: boolean; disabled: boolean };

/**
 * A database joins only while every database holds the starting point: HEAD on init and nothing
 * moved since. A project never restored (HEAD empty) is there by definition.
 */
export function atStartingPoint(head: Head | undefined): boolean {
  if (head === undefined || head.state_id === null) return true;
  return head.state_name === "init" && !head.dirty && head.status !== "unknown";
}

/** Inspect first, then the order the projects came in (by name). */
function inspectFirst(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => Number(b.kind === "inspect") - Number(a.kind === "inspect"));
}

/** One group per project that has a database, or the one project the screen is filtered to. */
export function groupByProject(
  rows: readonly AdapterWithProject[],
  projects: readonly Project[],
  only: string
): DatabaseGroup[] {
  const groups: DatabaseGroup[] = [];
  for (const project of inspectFirst(projects)) {
    if (only !== "" && project.slug !== only) continue;
    const mine = rows.filter((row) => row.project_slug === project.slug);
    if (mine.length === 0 && project.slug !== only) continue;
    groups.push({
      slug: project.slug,
      name: project.name,
      inspect: project.kind === "inspect",
      atStart: atStartingPoint(project.head),
      rows: mine,
    });
  }
  return groups;
}

/** The dialog's project picker: a project not at its starting point is offered but greyed out. */
export function pickerOptions(projects: readonly Project[]): ProjectOption[] {
  return inspectFirst(projects).map((project) => {
    const disabled = !atStartingPoint(project.head);
    return {
      value: project.slug,
      label: disabled ? `${project.name} (not at its starting point)` : project.name,
      inspect: project.kind === "inspect",
      disabled,
    };
  });
}

/** The project the dialog opens on: the one asked for when it may take a database, else the first that may. */
export function firstPickable(options: readonly ProjectOption[], wanted: string): string {
  const usable = options.filter((option) => !option.disabled);
  return usable.find((option) => option.value === wanted)?.value ?? usable[0]?.value ?? "";
}

export type DatabasesQuery = { project: string; create: boolean };

/** `?project=<slug>` filters the screen; `?new=1` opens the dialog, from a project's empty state. */
export function readQuery(search: string): DatabasesQuery {
  const params = new URLSearchParams(search);
  return { project: params.get("project") ?? "", create: params.get("new") === "1" };
}

export const DATABASE_ENGINE_FILTERS = [
  { value: "", label: "All engines" },
  ...DATABASE_ENGINE_OPTIONS,
] as const;
export const DATABASE_TIER_FILTERS = [
  { value: "", label: "All tiers" },
  { value: "tabular", label: TIER_LABEL.tabular },
  { value: "document", label: TIER_LABEL.document },
] as const;

export type DatabasesPresenter = Refreshable<AdapterWithProject[]> & {
  projects: Refreshable<Project[]>;
  table: TableView<AdapterWithProject, AdapterSort>;
  groups: () => DatabaseGroup[];
  project: () => string;
  setProject: (slug: string) => void;
  filters: () => AdapterFilters;
  setFilters: (patch: Partial<AdapterFilters>) => void;
  activeFilters: () => number;
  filtersOpen: () => boolean;
  toggleFilters: () => void;
  /** Read once: whether the screen was opened to add a database straight away. */
  takeCreatePreset: () => boolean;
  /** After a database joins or a checkout lands: both lists, since HEAD decides who may join. */
  refreshAll: () => void;
};

export function createDatabasesPresenter(): DatabasesPresenter {
  const query = readQuery(window.location.search);
  let createPreset = query.create;
  const databases = createRefreshable(() => adaptersModel.everywhere());
  const projects = createRefreshable(() => projectsModel.list());
  const table = createTableView<AdapterWithProject, AdapterSort>({
    rows: () => databases.value(),
    sorters: {
      name: { text: (row) => row.name },
      engine: { text: (row) => row.engine },
      tier: { text: (row) => row.tier },
      mode: { text: (row) => row.mode },
      status: { text: (row) => row.status },
    },
    fields: (row) => [
      row.name,
      row.project_name,
      row.engine,
      ENGINE_LABEL[row.engine],
      TIER_LABEL[row.tier],
      ADAPTER_MODE_LABEL[row.mode],
      ADAPTER_STATUS_LABEL[row.status],
    ],
  });
  const [project, setProject] = createSignal(query.project);
  const [filters, setFiltersSignal] = createSignal<AdapterFilters>(ADAPTER_FILTERS_EMPTY);
  const [filtersOpen, setFiltersOpen] = createSignal(query.project !== "");
  const filtered = createMemo(() =>
    table.rows().filter((row) => matchesAdapterFilters(row, filters()))
  );
  return {
    ...databases,
    projects,
    table: { ...table, rows: filtered },
    groups: () => groupByProject(filtered(), projects.value(), project()),
    project,
    setProject,
    filters,
    setFilters: (patch) => setFiltersSignal((current) => ({ ...current, ...patch })),
    activeFilters: () => {
      const current = filters();
      return activeFilterCount(
        project() !== "",
        current.engine !== "",
        current.tier !== "",
        current.mode !== "",
        current.status !== ""
      );
    },
    filtersOpen,
    toggleFilters: () => setFiltersOpen((open) => !open),
    takeCreatePreset: () => {
      const preset = createPreset;
      createPreset = false;
      return preset;
    },
    refreshAll: () => {
      databases.refresh();
      projects.refresh();
    },
  };
}
