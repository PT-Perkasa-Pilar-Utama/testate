import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Tabs from "@/components/tabs.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { engineLabel } from "@/lib/labels.ts";
import { changedCount, qualifiedTable, troubled } from "./state.presenter.ts";
import type { DetailAdapter, StatePresenter } from "./state.presenter.ts";
import { formatBytes } from "./states.format.ts";

const SORTS = [
  { id: "changes", label: "Changes" },
  { id: "name", label: "Name" },
  { id: "rows", label: "Rows" },
] as const;

const CHANGE_VARIANT = { changed: "warning", added: "success", same: "secondary" } as const;

function noun(adapter: DetailAdapter, count: number): string {
  const one = adapter.engine === "mongodb" ? "collection" : "table";
  return count === 1 ? one : `${one}s`;
}

/** The databases of the state, one line each; the mark says one needs reading before trusting. */
export function DatabaseRail(props: { presenter: StatePresenter }): JSX.Element {
  const chosen = (adapter: DetailAdapter): boolean =>
    props.presenter.picked()?.adapter_id === adapter.adapter_id;
  return (
    <nav class="grid content-start gap-1" aria-label="Databases in this state">
      <For
        each={props.presenter.detail.value().adapters}
        fallback={<p class="px-2 text-sm text-muted">No databases in this state.</p>}
      >
        {(adapter) => (
          <button
            type="button"
            class={[
              "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-[80ms] hover:bg-hover",
              chosen(adapter)
                ? "bg-fill text-heading before:absolute before:top-2 before:bottom-2 before:-left-px before:w-0.5 before:rounded-full before:bg-accent"
                : "text-muted",
            ]}
            aria-current={chosen(adapter) ? "true" : undefined}
            onClick={() => props.presenter.pick(adapter.adapter_id)}
          >
            <Icon name="database" class="h-3.5 w-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{adapter.adapter_name}</span>
            <Show when={adapter.removed}>
              <Badge variant="secondary">removed</Badge>
            </Show>
            <Show when={troubled(adapter)}>
              <Icon name="triangle-alert" class="h-3.5 w-3.5 shrink-0 text-warning-fg" />
            </Show>
            {/* What moved against the parent, when anything did; else how many tables. */}
            <Show
              when={changedCount(adapter) > 0}
              fallback={
                <span class="shrink-0 font-mono text-xs tabular-nums">{adapter.tables.length}</span>
              }
            >
              <span class="shrink-0 font-mono text-xs text-warning-fg tabular-nums">
                ~{changedCount(adapter)}
              </span>
            </Show>
          </button>
        )}
      </For>
    </nav>
  );
}

/** The picked database: what it is, what went wrong reading it, and its tables to search. */
export function TablesPane(props: {
  presenter: StatePresenter;
  adapter: DetailAdapter;
  searchRef: (element: HTMLInputElement) => void;
}): JSX.Element {
  const a = (): DetailAdapter => props.adapter;
  return (
    <div class="grid content-start gap-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="font-medium text-heading">{a().adapter_name}</h3>
        <span class="text-sm text-muted">
          {engineLabel(a().engine)} {a().engine_version}
        </span>
        <span class="text-sm text-muted tabular-nums">
          {a().tables.length} {noun(a(), a().tables.length)} · {a().row_count} rows ·{" "}
          {formatBytes(a().byte_count)}
        </span>
        <Show when={a().consistency === "best_effort"}>
          <Badge variant="warning">read at different moments</Badge>
        </Show>
      </div>
      <Show when={a().warnings.length > 0}>
        <Banner variant="alert">
          {a()
            .warnings.map((warning) => warning.message)
            .join(" ")}
        </Banner>
      </Show>
      <Show when={a().removed_tables.length > 0}>
        <p class="text-sm text-muted">
          Not here any more, the parent had {a().removed_tables.length === 1 ? "it" : "them"}:{" "}
          <code>{a().removed_tables.join(", ")}</code>
        </p>
      </Show>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <Input
          ref={props.searchRef}
          size="sm"
          class="w-64"
          placeholder={`Find a ${noun(a(), 1)}... ( / )`}
          aria-label={`Find a ${noun(a(), 1)}`}
          value={props.presenter.needle()}
          onInput={(event) => props.presenter.setNeedle(event.currentTarget.value)}
        />
        <Tabs
          items={SORTS}
          value={props.presenter.sort()}
          onChange={(sort) => props.presenter.setSort(sort)}
          label="Sort tables"
          variant="segmented"
        />
      </div>
      <Table>
        <thead>
          <tr>
            <Head>{noun(a(), 1)}</Head>
            <Head>Against parent</Head>
            <Head numeric>Rows</Head>
            <Head numeric>Size</Head>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.presenter.tables()}
            fallback={
              <tr>
                <td colspan={4} class="px-3 py-4 text-sm text-muted">
                  Nothing matches.
                </td>
              </tr>
            }
          >
            {(table) => (
              <Row>
                <Cell>
                  <span class="flex items-center gap-2">
                    <code class="min-w-0 truncate">{qualifiedTable(table)}</code>
                    <Show when={table.warnings.length > 0}>
                      <span title={table.warnings.map((warning) => warning.message).join(" ")}>
                        <Icon name="triangle-alert" class="h-3.5 w-3.5 shrink-0 text-warning-fg" />
                      </span>
                    </Show>
                  </span>
                </Cell>
                <Cell>
                  <Show when={table.change}>
                    {(change) => <Badge variant={CHANGE_VARIANT[change()]}>{change()}</Badge>}
                  </Show>
                </Cell>
                <Cell numeric>{table.rows}</Cell>
                <Cell numeric>{formatBytes(table.bytes)}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </div>
  );
}
