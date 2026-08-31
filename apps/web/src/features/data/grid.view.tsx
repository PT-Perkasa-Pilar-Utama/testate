import type { JSX } from "@solidjs/web";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import type { JsonObject } from "@testate/shared";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Select from "@/components/select.tsx";
import { Cell, EmptyRow, Head, Row, Table, TableToolbar } from "@/components/table.tsx";
import FixtureDialog from "./fixture.view.tsx";
import { NUMERIC_TYPE, PAGE_SIZES, createGridPresenter } from "./grid.presenter.ts";
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

function RowActions(props: { presenter: GridPresenter; row: JsonObject }): JSX.Element {
  const row = (): JsonObject => props.row;
  return (
    <Cell pinned>
      <div class="flex gap-1">
        <Show when={props.presenter.table()?.primary_key?.length}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void props.presenter.editing.fixtureFor(row(), {
                depth: 2,
                direction: "parents",
                format: "sql",
              })
            }
          >
            Fixture
          </Button>
        </Show>
        <Show when={props.presenter.editing.canWrite()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => props.presenter.editing.openUpdate(row())}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void props.presenter.editing.remove(row())}
          >
            Delete
          </Button>
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
  return (
    <section class="grid gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">
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
          <p class="text-xs text-muted">
            Masked for your role: {presenter.page.value().masked_columns.join(", ")}
          </p>
        </Show>
        <div class="overflow-x-auto">
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
                fallback={<EmptyRow>No rows match. Clear a filter to see more.</EmptyRow>}
              >
                <For each={presenter.page.value().data}>
                  {(row) => (
                    <Row>
                      <For each={presenter.page.value().columns}>
                        {(column) => (
                          <Cell numeric={NUMERIC_TYPE.test(column.type)}>
                            <FkCell
                              presenter={presenter}
                              column={column.name}
                              value={row[column.name]}
                            />
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
        </div>
        <Pager presenter={presenter} />
        <Show when={presenter.table()}>
          {(table) => <RowForm presenter={presenter.editing} table={table()} />}
        </Show>
        <FixtureDialog presenter={presenter.editing} />
      </Loading>
    </section>
  );
}
