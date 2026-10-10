import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import EmptyState from "@/components/empty-state.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import PageHeader from "@/components/page-header.tsx";
import Pending from "@/components/pending.tsx";
import Select from "@/components/select.tsx";
import { TableFooter, TableSearch } from "@/components/table.tsx";
import { humanMessage } from "@/lib/api-error.ts";
import { hasRole } from "@/lib/session.ts";
import {
  ADAPTER_MODE_FILTER_OPTIONS,
  ADAPTER_STATUS_FILTER_OPTIONS,
} from "../adapters/adapters.fields.ts";
import DatabaseCreator from "./databases.creator.view.tsx";
import DatabaseGroupView from "./databases.group.view.tsx";
import {
  DATABASE_ENGINE_FILTERS,
  DATABASE_TIER_FILTERS,
  createDatabasesPresenter,
  pickerOptions,
} from "./databases.presenter.ts";
import type { DatabasesPresenter } from "./databases.presenter.ts";

function Filters(props: { presenter: DatabasesPresenter }): JSX.Element {
  const projectOptions = () => [
    { value: "", label: "All projects" },
    ...props.presenter.projects.value().map((project) => ({
      value: project.slug,
      label: project.name,
    })),
  ];
  return (
    <FilterPanel open={props.presenter.filtersOpen()}>
      <FilterField label="Project">
        <Select
          options={projectOptions()}
          value={props.presenter.project()}
          onChange={(value) => props.presenter.setProject(value)}
        />
      </FilterField>
      <FilterField label="Engine">
        <Select
          options={DATABASE_ENGINE_FILTERS}
          value={props.presenter.filters().engine}
          onChange={(value) => props.presenter.setFilters({ engine: value })}
        />
      </FilterField>
      <FilterField label="Tier">
        <Select
          options={DATABASE_TIER_FILTERS}
          value={props.presenter.filters().tier}
          onChange={(value) => props.presenter.setFilters({ tier: value })}
        />
      </FilterField>
      <FilterField label="Mode">
        <Select
          options={ADAPTER_MODE_FILTER_OPTIONS}
          value={props.presenter.filters().mode}
          onChange={(value) => props.presenter.setFilters({ mode: value })}
        />
      </FilterField>
      <FilterField label="Status">
        <Select
          options={ADAPTER_STATUS_FILTER_OPTIONS}
          value={props.presenter.filters().status}
          onChange={(value) => props.presenter.setFilters({ status: value })}
        />
      </FilterField>
    </FilterPanel>
  );
}

/**
 * Every database in one place, grouped by project, Inspect first: a tier is a menu
 * (docs/decisions/2026-10-10-databases-menu.md). An adapter's own page stays under its project.
 */
export default function DatabasesView(): JSX.Element {
  const presenter = createDatabasesPresenter();
  const openNow = presenter.takeCreatePreset();
  return (
    <section class="grid gap-4">
      <PageHeader
        eyebrow="Workspace"
        title="Databases"
        description="PostgreSQL, MySQL, MariaDB and MongoDB, across every project you can see."
        actions={
          <Show when={hasRole("qa")}>
            <Loading fallback={<span />}>
              <DatabaseCreator
                options={pickerOptions(presenter.projects.value())}
                wanted={presenter.project()}
                openNow={openNow}
                onCreated={() => presenter.refreshAll()}
              />
            </Loading>
          </Show>
        }
      />
      <div class="flex flex-wrap items-center justify-end gap-2">
        <TableSearch
          placeholder="Search databases..."
          value={presenter.table.query()}
          onInput={(value) => presenter.table.setQuery(value)}
        />
        <FilterToggle
          open={presenter.filtersOpen()}
          active={presenter.activeFilters()}
          onToggle={() => presenter.toggleFilters()}
        />
      </div>
      <Errored
        fallback={(error) => (
          <Banner variant="error">
            {humanMessage(error(), "The databases could not be listed")}
          </Banner>
        )}
      >
        <Loading fallback={<Pending>Loading databases...</Pending>}>
          <Filters presenter={presenter} />
          <Show
            when={presenter.groups().length > 0}
            fallback={
              <EmptyState icon="database" title="No databases yet">
                Connect the databases behind the system under test, then take a state of them.
              </EmptyState>
            }
          >
            <div class="grid gap-5">
              <For each={presenter.groups()}>
                {(group) => <DatabaseGroupView group={group} presenter={presenter} />}
              </For>
            </div>
            <TableFooter shown={presenter.table.rows().length} noun="databases" hasMore={false} />
          </Show>
        </Loading>
      </Errored>
    </section>
  );
}
