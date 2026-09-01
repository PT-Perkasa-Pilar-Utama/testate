import type { JSX } from "@solidjs/web";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import type { JsonObject, TableSchema } from "@testate/shared";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuItem } from "@/components/menu.tsx";
import Select from "@/components/select.tsx";
import { Cell, EmptyRow, Head, Row, Table, TableToolbar } from "@/components/table.tsx";
import FixtureDialog from "./fixture.view.tsx";
import { NUMERIC_TYPE, PAGE_SIZES, cellText, createGridPresenter } from "./grid.presenter.ts";
import { ExportLinks, FilterBar, WriteControls } from "./grid-toolbar.view.tsx";
import type { GridPresenter } from "./grid.presenter.ts";
import { FkCell, ForeignKeys } from "./grid-cells.view.tsx";
import RowForm from "./row-form.view.tsx";

const SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: size, label: `${size} rows` }));
function Pager(props: { presenter: GridPresenter }): JSX.Element {
  const page = (): ReturnType<GridPresenter["page"]["value"]>["page"] =>
    props.presenter.page.value().page;
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
      <div class="flex flex-wrap items-center gap-2">
        <span>{props.presenter.page.value().data.length} rows on this page</span>
        <Badge variant="secondary">{page().kind} paging</Badge>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          class="w-28!"
          aria-label="Rows per page"
          options={SIZE_OPTIONS}
          value={props.presenter.limit()}
          onChange={(size) => props.presenter.setLimit(size)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={props.presenter.depth() === 0}
          onClick={() => props.presenter.first()}
        >
          First
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={props.presenter.depth() === 0}
          onClick={() => props.presenter.previous()}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page().next_cursor === null}
          onClick={() => props.presenter.next()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

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
            variant="ghost"
            onClick={() => props.presenter.editing.openUpdate(row())}
          >
            Edit
          </Button>
        </Show>
        <Show when={canFixture() || canWrite()}>
          <Menu label="Row actions">
            <Show when={canFixture()}>
              <MenuItem
                onClick={() =>
                  void props.presenter.editing.fixtureFor(row(), {
                    depth: 2,
                    direction: "parents",
                    format: "sql",
                  })
                }
              >
                Extract fixture
              </MenuItem>
            </Show>
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
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <Icon name="table" class="h-4 w-4 text-muted" />
          <AdapterCrumb slug={props.slug} id={props.id} /> / <code>{props.table}</code>
        </h2>
        <ForeignKeys presenter={presenter} />
      </div>
      <Loading fallback={<p class="text-muted">Loading rows...</p>}>
        <TableToolbar
          actions={
            <>
              <ExportLinks presenter={presenter} />
              <WriteControls presenter={presenter} />
            </>
          }
        >
          <FilterBar
            presenter={presenter}
            columns={presenter.page.value().columns.map((column) => column.name)}
          />
        </TableToolbar>
        <Show when={presenter.page.value().masked_columns.length > 0}>
          <p class="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="eye-off" class="h-3 w-3 shrink-0" />
            Masked for your role: {presenter.page.value().masked_columns.join(", ")}
          </p>
        </Show>
        <Table>
          <thead>
            <tr>
              <For each={presenter.page.value().columns}>
                {(column) => (
                  <Head numeric={NUMERIC_TYPE.test(column.type)}>
                    <button
                      type="button"
                      class="cursor-pointer font-medium hover:underline"
                      onClick={() => presenter.toggleSort(column.name)}
                    >
                      {column.name}
                      <Show when={presenter.sort() === column.name}>
                        {presenter.order() === "asc" ? " ↑" : " ↓"}
                      </Show>
                    </button>
                    <span class="ml-1 text-xs text-muted">{column.type}</span>
                  </Head>
                )}
              </For>
              <Head pinned>Actions</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.page.value().data.length > 0}
              fallback={
                <EmptyRow>
                  {presenter.filters().length > 0
                    ? "No rows match your filters. Remove one above to see more."
                    : "This table has no rows yet. Write mode can insert one, or an import can load some."}
                </EmptyRow>
              }
            >
              <For each={presenter.page.value().data}>
                {(row) => (
                  <Row>
                    <For each={presenter.page.value().columns}>
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
                              presenter={presenter}
                              column={column.name}
                              value={row[column.name]}
                            />
                          </span>
                        </Cell>
                      )}
                    </For>
                    <RowActions presenter={presenter} row={row} />
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
        <Pager presenter={presenter} />
        {/*
          Keyed on the table, not merely shown when there is one. Moving to another table in the
          same adapter swaps one schema object for another without passing through null, so a
          <Show> would keep the mounted form and its first table's columns. <For> is keyed by
          identity in Solid 2, so the form is rebuilt for the table it is actually editing.
        */}
        <For each={openTable()}>
          {(table) => <RowForm presenter={presenter.editing} table={table} />}
        </For>
        <FixtureDialog presenter={presenter.editing} />
      </Loading>
    </section>
  );
}
