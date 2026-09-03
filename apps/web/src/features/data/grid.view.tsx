import type { JSX } from "@solidjs/web";
import AdapterBreadcrumbs from "@/features/adapter/adapter.crumb.view.tsx";
import type { JsonObject, TableSchema } from "@testate/shared";
import { For, Loading, Show } from "solid-js";

import Pending from "@/components/pending.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuItem } from "@/components/menu.tsx";
import { navigate } from "@/lib/router.ts";
import { Cell, EmptyRow, Head, Row, Table, TableToolbar } from "@/components/table.tsx";
import FixtureDialog from "./fixture.view.tsx";
import { NUMERIC_TYPE, cellText, createGridPresenter } from "./grid.presenter.ts";
import DocumentBrowser from "./document.view.tsx";
import { ExportLinks, FilterBar, Pager, WriteControls, WriteStrip } from "./grid-toolbar.view.tsx";
import type { GridPresenter } from "./grid.presenter.ts";
import { FkCell, ForeignKeys } from "./grid-cells.view.tsx";
import RowForm from "./row-form.view.tsx";

/**
 * Edit is the one action a person usually wants on a row, so it stays a plain button; extracting a
 * fixture and deleting the row live in the overflow menu, delete last and marked (`menu.tsx`).
 */
function RowActions(props: { presenter: GridPresenter; row: JsonObject }): JSX.Element {
  const row = (): JsonObject => props.row;
  const canFixture = (): boolean => (props.presenter.table()?.primary_key?.length ?? 0) > 0;
  const canWrite = (): boolean => props.presenter.editing.canWrite();
  return (
    <Cell pinned>
      <div class="flex items-center justify-end gap-1">
        <Show when={canWrite()}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.presenter.editing.openUpdate(row())}
          >
            <Icon name="pencil" class="h-3 w-3" />
            Edit
          </Button>
        </Show>
        {/* Out front, not in the overflow: a fixture is what a tester takes from a row most,
            after an edit, and a menu hid it well enough that nobody found it. */}
        <Show when={canFixture()}>
          <Button
            size="sm"
            variant="outline"
            title="Extract this row and its related rows as a fixture"
            onClick={() =>
              void props.presenter.editing.fixtureFor(row(), {
                depth: 2,
                direction: "parents",
                format: "sql",
              })
            }
          >
            <Icon name="file-down" class="h-3 w-3" />
            Fixture
          </Button>
        </Show>
        <Show when={canWrite()}>
          <Menu label="Row actions">
            <Show when={canWrite()}>
              <MenuItem danger onClick={() => void props.presenter.editing.remove(row())}>
                Delete row
              </MenuItem>
            </Show>
          </Menu>
        </Show>
      </div>
    </Cell>
  );
}

export default function GridView(props: { slug: string; id: string; table: string }): JSX.Element {
  const presenter = createGridPresenter(
    () => props.slug,
    () => props.id,
    () => props.table
  );
  /** The open table as a one-item list, so `<For>` can key the row form on it. */
  const openTable = (): TableSchema[] => {
    const found = presenter.table();
    return found === null ? [] : [found];
  };
  return (
    <section class="grid gap-4">
      <AdapterBreadcrumbs
        slug={props.slug}
        id={props.id}
        leaf={props.table}
        back="Back to the database"
      />
      <Loading fallback={<Pending>Loading rows...</Pending>}>
        <Show
          when={presenter.adapter.value().tier !== "document"}
          fallback={
            <DocumentBrowser
              presenter={presenter}
              slug={props.slug}
              id={props.id}
              table={props.table}
              onCollection={(name) =>
                navigate(
                  `/projects/${encodeURIComponent(props.slug)}/adapters/${encodeURIComponent(props.id)}/tables/${encodeURIComponent(name)}`
                )
              }
            />
          }
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight text-heading">
              <Icon name="table" class="h-4 w-4 text-muted" />
              <code>{props.table}</code>
            </h2>
            <ForeignKeys presenter={presenter} />
          </div>
          <GridTable presenter={presenter} openTable={openTable} />
        </Show>
      </Loading>
    </section>
  );
}

/** The Tabular tier's table: columns, sortable heads, a row of actions, write mode, fixtures. */
function GridTable(props: {
  presenter: GridPresenter;
  openTable: () => TableSchema[];
}): JSX.Element {
  const openTable = (): TableSchema[] => props.openTable();
  return (
    <>
      <TableToolbar
        actions={
          <>
            <ExportLinks presenter={props.presenter} />
            <WriteControls presenter={props.presenter} />
          </>
        }
      >
        <FilterBar
          presenter={props.presenter}
          columns={props.presenter.page.value().columns.map((column) => column.name)}
        />
      </TableToolbar>
      <WriteStrip presenter={props.presenter} />
      <Show when={props.presenter.page.value().masked_columns.length > 0}>
        <p class="flex items-center gap-1.5 text-xs text-muted">
          <Icon name="eye-off" class="h-3 w-3 shrink-0" />
          Masked for your role: {props.presenter.page.value().masked_columns.join(", ")}
        </p>
      </Show>
      <Table>
        <thead>
          <tr>
            <For each={props.presenter.page.value().columns}>
              {(column) => (
                <Head numeric={NUMERIC_TYPE.test(column.type)} identifier>
                  <button
                    type="button"
                    class="cursor-pointer font-medium hover:underline"
                    onClick={() => props.presenter.toggleSort(column.name)}
                  >
                    {column.name}
                    <Show when={props.presenter.sort() === column.name}>
                      {props.presenter.order() === "asc" ? " ↑" : " ↓"}
                    </Show>
                  </button>
                  <span class="ml-1.5 text-[11px] text-muted">{column.type}</span>
                </Head>
              )}
            </For>
            <Head pinned>Actions</Head>
          </tr>
        </thead>
        <tbody>
          <Show
            when={props.presenter.page.value().data.length > 0}
            fallback={
              <EmptyRow>
                {props.presenter.filters().length > 0
                  ? "No rows match your filters. Remove one above to see more."
                  : "This table has no rows yet. Write mode can insert one, or an import can load some."}
              </EmptyRow>
            }
          >
            <For each={props.presenter.page.value().data}>
              {(row) => (
                <Row>
                  <For each={props.presenter.page.value().columns}>
                    {(column) => (
                      <Cell numeric={NUMERIC_TYPE.test(column.type)}>
                        {/* A cell holds whatever the table holds: a one-word flag or a page of
                              JSON. FkCell renders a link for a foreign key, so the truncation
                              wraps it from outside rather than editing what it returns; 18rem is
                              this table's own default width for an unbounded string. */}
                        <span
                          class="block max-w-[18rem] truncate"
                          title={cellText(row[column.name])}
                        >
                          <FkCell
                            presenter={props.presenter}
                            column={column.name}
                            value={row[column.name]}
                          />
                        </span>
                      </Cell>
                    )}
                  </For>
                  <RowActions presenter={props.presenter} row={row} />
                </Row>
              )}
            </For>
          </Show>
        </tbody>
      </Table>
      <Pager presenter={props.presenter} />
      {/*
          Keyed on the table, not merely shown when there is one. Moving to another table in the
          same adapter swaps one schema object for another without passing through null, so a
          <Show> would keep the mounted form and its first table's columns. <For> is keyed by
          identity in Solid 2, so the form is rebuilt for the table it is actually editing.
        */}
      <For each={openTable()}>
        {(table) => <RowForm presenter={props.presenter.editing} table={table} />}
      </For>
      <FixtureDialog presenter={props.presenter.editing} />
    </>
  );
}
