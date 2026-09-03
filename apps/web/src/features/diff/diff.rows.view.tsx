import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { DiffRow, JsonValue } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import type { DiffPresenter } from "./diff.presenter.ts";
import { pretty } from "./diff.text.ts";

export const OP_TONE = { added: "success", removed: "error", changed: "warning" } as const;

function cellOf(row: DiffRow, side: "before" | "after", column: string): JsonValue {
  return (side === "before" ? row.before : row.after)?.[column] ?? null;
}

/** One line of a cell for the grid; the full value goes to the dialog. */
function show(value: JsonValue): string {
  return value === null ? "" : pretty(value).replaceAll("\n", " ");
}

/** One row, both sides, with the columns the API already named as changed tinted. */
function RowPair(props: {
  row: DiffRow;
  columns: string[];
  presenter: DiffPresenter;
}): JSX.Element {
  const changed = (column: string): boolean => props.row.changed_columns?.includes(column) === true;
  const cell = (side: "before" | "after", column: string): JSX.Element => (
    <td
      class={[
        "max-w-[16rem] truncate px-2 py-1 align-top font-mono text-xs",
        {
          "cursor-pointer bg-warning-tint text-warning-fg hover:underline": changed(column),
          "text-muted": !changed(column),
        },
      ]}
      title={show(cellOf(props.row, side, column))}
      onClick={() => {
        if (!changed(column)) return;
        props.presenter.openCell({
          column,
          before: cellOf(props.row, "before", column),
          after: cellOf(props.row, "after", column),
        });
      }}
    >
      {show(cellOf(props.row, side, column))}
    </td>
  );
  return (
    <>
      <Show when={props.row.before}>
        <tr class="border-t border-hairline">
          <td class="px-2 py-1 align-top">
            <Badge variant={OP_TONE[props.row.op]}>{props.row.op === "added" ? "" : "-"}</Badge>
          </td>
          <For each={props.columns}>{(column) => cell("before", column)}</For>
        </tr>
      </Show>
      <Show when={props.row.after}>
        <tr class={props.row.before === null ? "border-t border-hairline" : ""}>
          <td class="px-2 py-1 align-top">
            <Badge variant={OP_TONE[props.row.op]}>+</Badge>
          </td>
          <For each={props.columns}>{(column) => cell("after", column)}</For>
        </tr>
      </Show>
    </>
  );
}

/** A tabular table's moved rows: both sides of each, one column per column. */
export default function RowTable(props: {
  rows: DiffRow[];
  columns: string[];
  presenter: DiffPresenter;
}): JSX.Element {
  return (
    <>
      <div class="overflow-x-auto rounded-lg bg-surface ring ring-line">
        <table class="w-full text-left">
          <thead>
            <tr class="bg-fill">
              <th class="w-10 px-2 py-1.5 text-xs text-muted" />
              <For each={props.columns}>
                {(column) => <th class="px-2 py-1.5 text-xs font-medium text-muted">{column}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(row) => <RowPair row={row} columns={props.columns} presenter={props.presenter} />}
            </For>
          </tbody>
        </table>
      </div>
      <p class="text-sm text-muted">
        A tinted cell changed. Click one to read the value in full. The first 100 rows, masked to
        your role.
      </p>
    </>
  );
}
