import type { JSX } from "@solidjs/web";
import Icon from "@/components/icon.tsx";
import { Eyebrow } from "@/components/page-header.tsx";
import { Errored, For, Loading, Show } from "solid-js";
import type { DiffRow, DiffTable, JsonValue } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Breadcrumbs from "@/components/breadcrumbs.tsx";
import PageHeader from "@/components/page-header.tsx";
import Tabs from "@/components/tabs.tsx";
import { DIFF_OP_LABEL } from "@/lib/labels.ts";
import { formatWhen } from "@/lib/format.ts";
import { columnsOf, createDiffPresenter, tableName } from "./diff.presenter.ts";
import type { DiffPresenter, Target } from "./diff.presenter.ts";
import { pretty } from "./diff.text.ts";
import ValueDialog from "./diff.value.tsx";

const OPS = [
  { id: "", label: "All" },
  { id: "added", label: DIFF_OP_LABEL.added },
  { id: "removed", label: DIFF_OP_LABEL.removed },
  { id: "changed", label: DIFF_OP_LABEL.changed },
] as const;

const OP_TONE = { added: "success", removed: "error", changed: "warning" } as const;

function cellOf(row: DiffRow, side: "before" | "after", column: string): JsonValue {
  return (side === "before" ? row.before : row.after)?.[column] ?? null;
}

/** One line of a cell for the grid; the full value goes to the dialog. */
function show(value: JsonValue): string {
  return value === null ? "" : pretty(value).replaceAll("\n", " ");
}

/** What moved in a table, each count in the colour the diff rows use for it; nothing when nothing did. */
function Counts(props: { table: DiffTable }): JSX.Element {
  return (
    <span class="ml-auto flex shrink-0 gap-1.5 font-mono text-xs tabular-nums">
      <Show when={props.table.added > 0}>
        <span class="text-success-fg">+{props.table.added}</span>
      </Show>
      <Show when={props.table.removed > 0}>
        <span class="text-danger-fg">-{props.table.removed}</span>
      </Show>
      <Show when={props.table.changed > 0}>
        <span class="text-warning-fg">~{props.table.changed}</span>
      </Show>
    </span>
  );
}

/** The tables of every adapter, with what moved in each; the rail is how you pick one. */
function TableRail(props: { presenter: DiffPresenter }): JSX.Element {
  // One key per row rather than two comparisons: the old pair read the candidate's own table when
  // nothing was selected yet, so a second row lit up beside the chosen one.
  const key = (target: Target): string => `${target.adapter_id}/${tableName(target.table)}`;
  const chosen = (target: Target): boolean => {
    const at = props.presenter.target();
    return at !== null && key(at) === key(target);
  };
  return (
    <nav class="grid gap-5" aria-label="Tables in this diff">
      <For each={props.presenter.diff.value().adapters}>
        {(adapter) => (
          <div class="grid gap-1">
            <h3 class="flex items-center gap-1.5 px-2">
              <Icon name="database" class="h-3.5 w-3.5 text-muted" />
              <Eyebrow>{adapter.name}</Eyebrow>
            </h3>
            <For
              each={adapter.tables}
              fallback={<p class="px-2 text-sm text-muted">Nothing compared here.</p>}
            >
              {(table) => (
                <button
                  type="button"
                  class={[
                    "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-[80ms] hover:bg-hover",
                    chosen({ adapter_id: adapter.adapter_id, adapter_name: adapter.name, table })
                      ? "bg-fill text-heading before:absolute before:top-2 before:bottom-2 before:-left-px before:w-0.5 before:rounded-full before:bg-accent"
                      : "text-muted",
                  ]}
                  onClick={() =>
                    void props.presenter.select({
                      adapter_id: adapter.adapter_id,
                      adapter_name: adapter.name,
                      table,
                    })
                  }
                >
                  <Icon name="table" class="h-3.5 w-3.5 shrink-0" />
                  <span class="truncate">{tableName(table)}</span>
                  <Counts table={table} />
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </nav>
  );
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

/**
 * One diff, on a page of its own.
 *
 * It was a dialog over a list, which is the wrong shape for a comparison: the rows are wide, there
 * are two of everything, and a person reads down a table rather than across a modal. No API work:
 * `GET /diffs/:id/rows` already answers with before, after and the columns that changed
 * (docs/PROJECT_REWORK.md).
 */
export default function DiffView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createDiffPresenter(
    () => props.slug,
    () => props.id
  );
  const columns = (): string[] => columnsOf(presenter.page()?.data ?? []);
  return (
    <section class="grid gap-4">
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-muted">Loading the diff...</p>}>
          <Breadcrumbs
            items={[
              { label: "Projects", href: "/projects" },
              { label: props.slug, href: `/projects/${props.slug}` },
              { label: "activity", href: `/projects/${props.slug}?tab=activity` },
              { label: "diff" },
            ]}
          />
          <PageHeader
            eyebrow="Comparison"
            title={`${presenter.diff.value().base.name} → ${
              "live" in presenter.diff.value().target ? "live databases" : "another state"
            }`}
            description={`Made ${formatWhen(presenter.diff.value().created_at)}. Kept until ${formatWhen(presenter.diff.value().expires_at)}.`}
          />
          <div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
            <TableRail presenter={presenter} />
            <div class="grid content-start gap-3">
              <Show
                when={presenter.target()}
                fallback={<p class="text-muted">Pick a table on the left.</p>}
              >
                {(target) => (
                  <>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <h3 class="font-medium text-heading">
                        {target().adapter_name} · {tableName(target().table)}
                      </h3>
                      <Tabs
                        items={OPS}
                        value={presenter.op()}
                        onChange={(op) => void presenter.setOp(op)}
                        label="Which rows"
                        variant="segmented"
                      />
                    </div>
                    <Show when={(presenter.page()?.masked_columns ?? []).length > 0}>
                      <Banner variant="default">
                        Masked here: {(presenter.page()?.masked_columns ?? []).join(", ")}
                      </Banner>
                    </Show>
                    <Show
                      when={(presenter.page()?.data ?? []).length > 0}
                      fallback={
                        <p class="text-muted">
                          {presenter.busy() ? "Reading rows..." : "No rows for this filter."}
                        </p>
                      }
                    >
                      <div class="overflow-x-auto rounded-lg bg-surface ring ring-line">
                        <table class="w-full text-left">
                          <thead>
                            <tr class="bg-fill">
                              <th class="w-10 px-2 py-1.5 text-xs text-muted" />
                              <For each={columns()}>
                                {(column) => (
                                  <th class="px-2 py-1.5 text-xs font-medium text-muted">
                                    {column}
                                  </th>
                                )}
                              </For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={presenter.page()?.data ?? []}>
                              {(row) => (
                                <RowPair row={row} columns={columns()} presenter={presenter} />
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                      <p class="text-sm text-muted">
                        A tinted cell changed; click one to read the value in full. The first 100
                        rows, masked to your role.
                      </p>
                    </Show>
                  </>
                )}
              </Show>
            </div>
          </div>
        </Loading>
      </Errored>
      <ValueDialog cell={presenter.cell()} onClose={() => presenter.closeCell()} />
    </section>
  );
}
