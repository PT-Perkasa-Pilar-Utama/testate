import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import Switch from "@/components/switch.tsx";
import { hasRole } from "@/lib/session.ts";
import { FILTER_OP_LABEL } from "@/lib/labels.ts";
import { FILTER_OPS, PAGE_SIZES, filterNeedsValue } from "./grid.presenter.ts";
import type { Filter, FilterOp, GridPresenter } from "./grid.presenter.ts";

const OP_OPTIONS = FILTER_OPS.map((op) => ({ value: op, label: FILTER_OP_LABEL[op] }));

/** One removable filter, in the words it reads as: "status eq active". */
function FilterChip(props: { filter: Filter; onRemove: () => void }): JSX.Element {
  return (
    <Badge variant="outline">
      <span>
        {props.filter.column} {props.filter.op} {props.filter.value}
      </span>
      <button
        type="button"
        class="-mr-0.5 cursor-pointer rounded-full p-0.5 hover:bg-hover"
        aria-label={`Remove filter ${props.filter.column} ${props.filter.op} ${props.filter.value}`}
        onClick={() => props.onRemove()}
      >
        <Icon name="x" class="h-3 w-3" />
      </button>
    </Badge>
  );
}

export function FilterBar(props: { presenter: GridPresenter; columns: string[] }): JSX.Element {
  const [column, setColumn] = createSignal("");
  const [op, setOp] = createSignal<FilterOp>("eq");
  const [value, setValue] = createSignal("");
  const columnOptions = (): { value: string; label: string }[] =>
    props.columns.map((name) => ({ value: name, label: name }));
  // The API refuses a filter whose operator needs a value and has none, and that refusal takes the
  // whole grid into its error boundary. Say so here instead, where the empty box is.
  const missingValue = (): boolean => filterNeedsValue(op()) && value().trim() === "";
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const chosen = column() === "" ? (props.columns[0] ?? "") : column();
    if (chosen === "" || missingValue()) return;
    props.presenter.addFilter({ column: chosen, op: op(), value: value() });
    setValue("");
  };
  return (
    <div class="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-1.5 ring ring-line">
      <Icon name="funnel" class="h-3.5 w-3.5 shrink-0 text-muted" />
      <form class="flex flex-wrap items-center gap-1.5" onSubmit={onSubmit}>
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
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={missingValue()}
          title={missingValue() ? `${op()} needs a value` : undefined}
        >
          <Icon name="plus" class="h-3.5 w-3.5" />
          Add filter
        </Button>
      </form>
      <Show when={props.presenter.filters().length > 0}>
        <span class="h-4 w-px bg-line" aria-hidden="true" />
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={props.presenter.filters()}>
            {(filter, index) => (
              <FilterChip filter={filter} onRemove={() => props.presenter.removeFilter(index())} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** The switch and its controls, once editing is actually available. */
function WriteSessionControls(props: { presenter: GridPresenter }): JSX.Element {
  const session = (): ReturnType<GridPresenter["editing"]["session"]> =>
    props.presenter.editing.session();
  return (
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <Switch
        label="Write mode"
        checked={session() !== null}
        onChange={(on) =>
          void (on ? props.presenter.editing.start() : props.presenter.editing.end())
        }
      />
    </div>
  );
}

/**
 * The strip under the toolbar while a write session is open: what is on, what protects you, and
 * the two things you do in it. It used to be three controls squeezed into the toolbar's corner,
 * where "stash taken" read as a badge and nobody could tell the session was the reason the rows
 * had Edit on them.
 */
export function WriteStrip(props: { presenter: GridPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.editing.session()}>
      {(open) => (
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent/10 px-4 py-2.5 ring ring-accent/30">
          <p class="flex items-center gap-2 text-sm text-body">
            <Icon name="pencil" class="h-4 w-4 shrink-0 text-accent" />
            <span>
              <span class="font-medium">Write mode is on.</span>{" "}
              <span class="text-muted">
                {open().stash_state_id === null
                  ? "Edits go to the live database. The first one stashes this table, so you can put it back."
                  : "Edits go to the live database. It was stashed before the first one, so you can put it back."}
              </span>
            </span>
          </p>
          <div class="flex flex-wrap items-center gap-3 text-sm">
            {/* The switch says which way it is, and the engine's own statement only when the
                checks are off: that is the moment a person wants to know what was sent. */}
            <div class="grid gap-0.5">
              <Switch
                label={
                  open().foreign_key_checks ? "Foreign-key checks on" : "Foreign-key checks off"
                }
                checked={open().foreign_key_checks}
                onChange={(on) => void props.presenter.editing.setForeignKeyChecks(on)}
              />
              <span class="text-xs text-muted">
                {open().foreign_key_checks
                  ? "Rows must reference rows that exist."
                  : `Rows may be inserted in any order (${open().fk_checks_mapping}).`}
              </span>
            </div>
            <Button size="sm" variant="accent" onClick={() => props.presenter.editing.openInsert()}>
              <Icon name="plus" class="h-3.5 w-3.5" />
              Insert row
            </Button>
            <Button size="sm" variant="outline" onClick={() => void props.presenter.editing.end()}>
              End write mode
            </Button>
          </div>
        </div>
      )}
    </Show>
  );
}

/** Write mode, qa-only; when it can't turn on, says why right here rather than just vanishing. */
export function WriteControls(props: { presenter: GridPresenter }): JSX.Element {
  return (
    <Show when={hasRole("qa")}>
      <Show
        when={props.presenter.editableReason() === null}
        fallback={
          <p class="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="lock" class="h-3 w-3" />
            {props.presenter.editableReason()}
          </p>
        }
      >
        <WriteSessionControls presenter={props.presenter} />
      </Show>
    </Show>
  );
}

/**
 * The table as a file. Anchors, not buttons: the browser streams straight to disk and the session
 * cookie carries the auth. Exporting used to mean opening the query console and writing SQL, which
 * a manual tester cannot do, and the result was capped at 500 rows without saying so. First in the
 * toolbar and carrying its own icon, so it reads as the way out of this table, not an afterthought.
 */
export function ExportLinks(props: { presenter: GridPresenter }): JSX.Element {
  return (
    <>
      <a class={buttonClass("secondary", "sm")} href={props.presenter.exportUrl("csv")} download>
        <Icon name="download" class="h-3.5 w-3.5" />
        Export CSV
      </a>
      <a class={buttonClass("secondary", "sm")} href={props.presenter.exportUrl("json")} download>
        <Icon name="download" class="h-3.5 w-3.5" />
        Export JSON
      </a>
    </>
  );
}

const SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: size, label: `${size} rows` }));
export function Pager(props: { presenter: GridPresenter; noun?: string | undefined }): JSX.Element {
  const page = (): ReturnType<GridPresenter["page"]["value"]>["page"] =>
    props.presenter.page.value().page;
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
      <div class="flex flex-wrap items-center gap-2">
        <span>
          {props.presenter.page.value().data.length} {props.noun ?? "rows"} on this page
        </span>
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
