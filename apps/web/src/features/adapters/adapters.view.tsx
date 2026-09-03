import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import { statusReason } from "@/lib/api-error.ts";
import Button from "@/components/button.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import Select from "@/components/select.tsx";
import { Cell, EmptyRow, Head, Row, SortColumn, Table, TableSearch } from "@/components/table.tsx";
import {
  ADAPTER_MODE_LABEL,
  ADAPTER_STATUS_LABEL,
  ENGINE_LABEL,
  TIER_LABEL,
} from "@/lib/labels.ts";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { CreateDialog } from "./adapters.create.view.tsx";
import {
  ADAPTER_MODE_FILTER_OPTIONS,
  ADAPTER_STATUS_FILTER_OPTIONS,
  ENGINE_FILTER_OPTIONS,
  STATUS_VARIANT,
  TIER_FILTER_OPTIONS,
} from "./adapters.fields.ts";
import { createAdaptersPresenter } from "./adapters.presenter.ts";

export default function AdaptersView(props: { slug: string }): JSX.Element {
  const presenter = createAdaptersPresenter(() => props.slug);
  const path = (id: string): string => `/projects/${props.slug}/adapters/${id}`;
  return (
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <TableSearch
          placeholder="Search adapters..."
          value={presenter.table.query()}
          onInput={(value) => presenter.table.setQuery(value)}
        />
        <FilterToggle
          open={presenter.filtersOpen()}
          active={presenter.activeFilters()}
          onToggle={() => presenter.toggleFilters()}
        />
        <Show when={hasRole("qa")}>
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New adapter
          </Button>
        </Show>
      </div>
      <FilterPanel open={presenter.filtersOpen()}>
        <FilterField label="Engine">
          <Select
            options={ENGINE_FILTER_OPTIONS}
            value={presenter.filters().engine}
            onChange={(value) => presenter.setFilters({ engine: value })}
          />
        </FilterField>
        <FilterField label="Tier">
          <Select
            options={TIER_FILTER_OPTIONS}
            value={presenter.filters().tier}
            onChange={(value) => presenter.setFilters({ tier: value })}
          />
        </FilterField>
        <FilterField label="Mode">
          <Select
            options={ADAPTER_MODE_FILTER_OPTIONS}
            value={presenter.filters().mode}
            onChange={(value) => presenter.setFilters({ mode: value })}
          />
        </FilterField>
        <FilterField label="Status">
          <Select
            options={ADAPTER_STATUS_FILTER_OPTIONS}
            value={presenter.filters().status}
            onChange={(value) => presenter.setFilters({ status: value })}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<Pending>Loading adapters...</Pending>}>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="name">
                Name
              </SortColumn>
              <SortColumn view={presenter.table} column="engine">
                Engine
              </SortColumn>
              <SortColumn view={presenter.table} column="tier">
                Tier
              </SortColumn>
              <SortColumn view={presenter.table} column="mode">
                Mode
              </SortColumn>
              <Head>Credential</Head>
              <SortColumn view={presenter.table} column="status">
                Status
              </SortColumn>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.table.rows().length > 0}
              fallback={
                <EmptyRow>
                  <Show
                    when={presenter.value().length > 0}
                    fallback="No adapters yet. Connect the databases behind the system under test to snapshot them."
                  >
                    No adapter matches your search or filters.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(adapter) => (
                  <Row>
                    <Cell>
                      <a
                        class="block max-w-[18rem] truncate text-info-fg hover:underline"
                        title={adapter.name}
                        href={href(path(adapter.id))}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(path(adapter.id));
                        }}
                      >
                        {adapter.name}
                      </a>
                    </Cell>
                    <Cell>
                      {ENGINE_LABEL[adapter.engine]}
                      {adapter.engine_version === null ? "" : ` ${adapter.engine_version}`}
                    </Cell>
                    <Cell>
                      <Badge variant="outline">{TIER_LABEL[adapter.tier]}</Badge>
                    </Cell>
                    <Cell>
                      <Badge variant={adapter.mode === "read_only" ? "info" : "secondary"}>
                        {ADAPTER_MODE_LABEL[adapter.mode]}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Show
                        when={adapter.credential.set}
                        fallback={<span class="text-muted">none</span>}
                      >
                        <code>
                          {adapter.credential.set ? adapter.credential.key_fingerprint : ""}
                        </code>
                      </Show>
                    </Cell>
                    <Cell wrap>
                      <div class="grid gap-0.5">
                        <Badge variant={STATUS_VARIANT[adapter.status]}>
                          {ADAPTER_STATUS_LABEL[adapter.status]}
                        </Badge>
                        <Show when={adapter.status !== "ok"}>
                          <span class="text-xs text-muted">
                            {statusReason(adapter.status_message) ?? "No reason recorded."}
                          </span>
                        </Show>
                      </div>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
      <CreateDialog presenter={presenter} kind="database" />
    </div>
  );
}
