import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { DiffRow, JsonValue } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { CELL_WIDTH, ValueCell } from "@/components/value-viewer.tsx";
import { oneLine } from "@/lib/value-view.ts";
import type { DiffPresenter } from "./diff.presenter.ts";

export const OP_TONE = { added: "success", removed: "error", changed: "warning" } as const;

/** The sign column stays at the left edge while the columns scroll under it. */
const SIGN_CELL = "sticky left-0 z-[1]";

function cellOf(row: DiffRow, side: "before" | "after", column: string): JsonValue {
  return (side === "before" ? row.before : row.after)?.[column] ?? null;
}

/** One row, both sides, with the columns the API already named as changed tinted. */
function RowPair(props: {
  row: DiffRow;
  columns: string[];
  presenter: DiffPresenter;
}): JSX.Element {
  const changed = (column: string): boolean => props.row.changed_columns?.includes(column) === true;
  const open = (column: string): void =>
    props.presenter.openCell({
      column,
      before: cellOf(props.row, "before", column),
      after: cellOf(props.row, "after", column),
    });
  // A changed cell opens the before and after; any other cell opens its own value when it is cut.
  const cell = (side: "before" | "after", column: string): JSX.Element => (
    <td
      class={[
        "px-2 py-1 align-top font-mono text-xs",
        changed(column) ? "bg-warning-tint text-warning-fg" : "text-muted",
      ]}
    >
      <Show
        when={changed(column)}
        fallback={<ValueCell value={cellOf(props.row, side, column)} title={column} />}
      >
        <button
          type="button"
          class={["block cursor-pointer truncate text-left hover:underline", CELL_WIDTH]}
          title={oneLine(cellOf(props.row, side, column))}
          onClick={() => open(column)}
        >
          {oneLine(cellOf(props.row, side, column))}
        </button>
      </Show>
    </td>
  );
  return (
    <>
      <Show when={props.row.before}>
        <tr class="border-t border-hairline">
          <td class={[SIGN_CELL, "bg-surface px-2 py-1 align-top"]}>
            <Badge variant={OP_TONE[props.row.op]}>{props.row.op === "added" ? "" : "-"}</Badge>
          </td>
          <For each={props.columns}>{(column) => cell("before", column)}</For>
        </tr>
      </Show>
      <Show when={props.row.after}>
        <tr class={props.row.before === null ? "border-t border-hairline" : ""}>
          <td class={[SIGN_CELL, "bg-surface px-2 py-1 align-top"]}>
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
      {/* Its own scroll area, both ways: a hundred rows of ids and timestamps used to push the
          sideways scrollbar to the bottom of the page and the header off the top of it. */}
      <div class="max-h-[70vh] overflow-auto rounded-lg bg-surface ring ring-line">
        <table class="w-full text-left">
          <thead class="sticky top-0 z-10">
            <tr class="bg-fill">
              <th class={[SIGN_CELL, "z-20 w-10 border-b border-line bg-fill px-2 py-1.5"]} />
              <For each={props.columns}>
                {(column) => (
                  <th class="border-b border-line px-2 py-1.5 text-xs font-medium whitespace-nowrap text-muted">
                    {column}
                  </th>
                )}
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
