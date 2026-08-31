import type { JSX } from "@solidjs/web";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import type { JsonObject } from "@testate/shared";
import { For, Loading, Show, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, EmptyRow, Head, Row, Table, TableToolbar } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import Switch from "@/components/switch.tsx";
import FixtureDialog from "./fixture.view.tsx";
import { FILTER_OPS, NUMERIC_TYPE, PAGE_SIZES, createGridPresenter } from "./grid.presenter.ts";
import type { FilterOp, GridPresenter } from "./grid.presenter.ts";
import { FkCell, ForeignKeys } from "./grid-cells.view.tsx";
import RowForm from "./row-form.view.tsx";

const OP_OPTIONS = FILTER_OPS.map((op) => ({ value: op, label: op }));

const SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: size, label: `${size} rows` }));
function FilterBar(props: { presenter: GridPresenter; columns: string[] }): JSX.Element {
  const [column, setColumn] = createSignal("");
  const [op, setOp] = createSignal<FilterOp>("eq");
  const [value, setValue] = createSignal("");
  const columnOptions = (): { value: string; label: string }[] =>
    props.columns.map((name) => ({ value: name, label: name }));
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const chosen = column() === "" ? (props.columns[0] ?? "") : column();
    if (chosen === "") return;
    props.presenter.addFilter({ column: chosen, op: op(), value: value() });
    setValue("");
  };
  return (
    <form class="flex flex-wrap items-end gap-2" onSubmit={onSubmit}>
      <Select
        size="sm"
        class="w-40!"
        aria-label="Filter column"
        options={columnOptions()}
        value={column() === "" ? (props.columns[0] ?? "") : column()}
        onChange={setColumn}
      />
      <Select
        size="sm"
        class="w-24!"
        aria-label="Filter operator"
        options={OP_OPTIONS}
        value={op()}
        onChange={setOp}
      />
      <Input
        size="sm"
        class="w-44!"
        aria-label="Filter value"
        placeholder="value"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
      <Button type="submit" size="sm" variant="secondary">
        Add filter
      </Button>
      <For each={props.presenter.filters()}>
        {(filter, index) => (
          <Badge variant="outline">
            {filter.column} {filter.op} {filter.value}
            <button
              type="button"
              class="ml-1 cursor-pointer"
              aria-label="Remove filter"
              onClick={() => props.presenter.removeFilter(index())}
            >
              ×
            </button>
          </Badge>
        )}
      </For>
    </form>
  );
}

function Pager(props: { presenter: GridPresenter }): JSX.Element {
  const page = (): ReturnType<GridPresenter["page"]["value"]>["page"] =>
    props.presenter.page.value().page;
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-kumo-subtle">
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

function WriteControls(props: { presenter: GridPresenter }): JSX.Element {
  const session = (): ReturnType<GridPresenter["editing"]["session"]> =>
    props.presenter.editing.session();
  return (
    <Show when={hasRole("qa") && props.presenter.editable()}>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <Switch
          label="Write mode"
          checked={session() !== null}
          onChange={(on) =>
            void (on ? props.presenter.editing.start() : props.presenter.editing.end())
          }
        />
        <Show when={session()}>
          {(open) => (
            <>
              <Switch
                label={`Foreign-key checks (${open().fk_checks_mapping})`}
                checked={open().foreign_key_checks}
                onChange={(on) => void props.presenter.editing.setForeignKeyChecks(on)}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() => props.presenter.editing.openInsert()}
              >
                Insert row
              </Button>
              <Show when={open().stash_state_id !== null}>
                <Badge variant="info">stash taken</Badge>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Show>
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
      <Loading fallback={<p class="text-kumo-subtle">Loading rows...</p>}>
        <TableToolbar actions={<WriteControls presenter={presenter} />}>
          <FilterBar
            presenter={presenter}
            columns={presenter.page.value().columns.map((column) => column.name)}
          />
        </TableToolbar>
        <Show when={presenter.page.value().masked_columns.length > 0}>
          <p class="text-xs text-kumo-subtle">
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
                      <span class="ml-1 text-xs text-kumo-subtle">{column.type}</span>
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
