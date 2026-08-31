import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import Switch from "@/components/switch.tsx";
import { hasRole } from "@/lib/session.ts";
import { FILTER_OPS } from "./grid.presenter.ts";
import type { FilterOp, GridPresenter } from "./grid.presenter.ts";

const OP_OPTIONS = FILTER_OPS.map((op) => ({ value: op, label: op }));

export function FilterBar(props: { presenter: GridPresenter; columns: string[] }): JSX.Element {
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

export function WriteControls(props: { presenter: GridPresenter }): JSX.Element {
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

/**
 * The table as a file. Anchors, not buttons: the browser streams straight to disk and the session
 * cookie carries the auth. Exporting used to mean opening the query console and writing SQL, which
 * a manual tester cannot do, and the result was capped at 500 rows without saying so.
 */
export function ExportLinks(props: { presenter: GridPresenter }): JSX.Element {
  return (
    <>
      <a class={buttonClass("secondary", "sm")} href={props.presenter.exportUrl("csv")} download>
        Export CSV
      </a>
      <a class={buttonClass("secondary", "sm")} href={props.presenter.exportUrl("json")} download>
        Export JSON
      </a>
    </>
  );
}
