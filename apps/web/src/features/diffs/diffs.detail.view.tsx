import type { JSX } from "@solidjs/web";
import { For, Show, createMemo, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import { Cell, EmptyRow, Head, Row, Table } from "@/components/table.tsx";
import { formatWhen } from "@/lib/format.ts";
import {
  diffTotals,
  hiddenCount,
  tableLabel,
  tablesToShow,
  targetLabel,
  totalsOf,
  touched,
} from "./diffs.presenter.ts";
import type { DiffAdapter, DiffTable, DiffsPresenter, Totals } from "./diffs.presenter.ts";

/**
 * A diff over ten adapters of twenty tables is two hundred rows, and almost every one of them says
 * zero. So the dialog leads with the totals, shows only the tables that moved, and folds each
 * quiet adapter down to a single line. Everything is still reachable: one toggle brings the
 * unchanged tables back, which is what you want when you expected a change and did not get one.
 */
export function DetailDialog(props: { presenter: DiffsPresenter }): JSX.Element {
  const [showUnchanged, setShowUnchanged] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  return (
    <Show when={props.presenter.detail()}>
      {(diff) => {
        const totals = createMemo(() => diffTotals(diff()));
        const hidden = createMemo(() => hiddenCount(diff()));
        const tableCount = createMemo(() =>
          diff().adapters.reduce((sum, adapter) => sum + adapter.tables.length, 0)
        );
        const adapters = createMemo(() =>
          diff().adapters.map((adapter) => ({
            adapter,
            totals: totalsOf(adapter.tables),
            shown: tablesToShow(adapter, showUnchanged(), filter()),
          }))
        );
        return (
          <Dialog
            open
            onClose={() => props.presenter.close()}
            title={`${diff().base.name} → ${targetLabel(diff().target)}`}
            description={`Expires ${formatWhen(diff().expires_at)}`}
            size="xl"
          >
            <div class="grid gap-4">
              <Summary totals={totals()} tables={tableCount()} adapters={diff().adapters.length} />
              <div class="flex flex-wrap items-center justify-between gap-2">
                <Input
                  type="search"
                  placeholder="filter tables..."
                  value={filter()}
                  onInput={(event) => setFilter(event.currentTarget.value)}
                  class="max-w-64"
                  aria-label="Filter tables"
                />
                <Show when={hidden() > 0}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowUnchanged((on) => !on)}
                    aria-pressed={showUnchanged() ? "true" : "false"}
                  >
                    {showUnchanged() ? "Hide" : "Show"} {hidden()} unchanged
                  </Button>
                </Show>
              </div>
              <For each={adapters()}>
                {(entry) => (
                  <AdapterSection
                    adapter={entry.adapter}
                    totals={entry.totals}
                    shown={entry.shown}
                    onRows={(table) =>
                      void props.presenter.openRows({
                        diff: diff(),
                        adapter_id: entry.adapter.adapter_id,
                        adapter_name: entry.adapter.name,
                        table: tableLabel(table),
                      })
                    }
                  />
                )}
              </For>
              <div class="flex justify-end">
                <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                  Close
                </Button>
              </div>
            </div>
          </Dialog>
        );
      }}
    </Show>
  );
}

/** The answer to "did anything change", before any scrolling. */
function Summary(props: { totals: Totals; tables: number; adapters: number }): JSX.Element {
  const quiet = (): boolean => props.totals.tables === 0;
  return (
    <div class="grid gap-1.5 rounded-lg bg-surface px-4 py-3 ring ring-line">
      <Show when={!quiet()} fallback={<p class="font-medium text-body">No differences.</p>}>
        <p class="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-medium tabular-nums">
          <Count value={props.totals.added} label="added" tone="text-success-fg" sign="+" />
          <Count value={props.totals.removed} label="removed" tone="text-danger-fg" sign="-" />
          <Count value={props.totals.changed} label="changed" tone="text-warning-fg" sign="~" />
        </p>
      </Show>
      <p class="text-xs text-muted">
        {props.totals.tables} of {props.tables} {props.tables === 1 ? "table" : "tables"} touched,
        across {props.adapters} {props.adapters === 1 ? "adapter" : "adapters"}
      </p>
    </div>
  );
}

function Count(props: { value: number; label: string; tone: string; sign: string }): JSX.Element {
  return (
    <span class={props.value === 0 ? "text-muted" : props.tone}>
      {props.value === 0 ? "0" : `${props.sign}${props.value}`} {props.label}
    </span>
  );
}

/** One adapter: a table of what moved, or a single line saying nothing did. */
function AdapterSection(props: {
  adapter: DiffAdapter;
  totals: Totals;
  shown: readonly DiffTable[];
  onRows: (table: DiffTable) => void;
}): JSX.Element {
  return (
    <section class="grid gap-2">
      <h3 class="flex flex-wrap items-center gap-2 font-medium">
        {props.adapter.name}
        <Show when={!props.adapter.compared}>
          <Badge variant="secondary">not compared</Badge>
        </Show>
        <Show when={props.totals.tables > 0}>
          <span class="text-xs font-normal text-muted tabular-nums">
            {props.totals.tables} of {props.adapter.tables.length} tables
          </span>
        </Show>
      </h3>
      <Show
        when={props.shown.length > 0}
        fallback={
          <p class="text-xs text-muted">
            No differences in {props.adapter.tables.length}{" "}
            {props.adapter.tables.length === 1 ? "table" : "tables"}.
          </p>
        }
      >
        <Table>
          <thead>
            <tr>
              <Head>Table</Head>
              <Head>Compare</Head>
              <Head numeric>Added</Head>
              <Head numeric>Removed</Head>
              <Head numeric>Changed</Head>
              <Head>Schema</Head>
              <Head pinned />
            </tr>
          </thead>
          <tbody>
            <For each={props.shown} fallback={<EmptyRow>No table matches that filter.</EmptyRow>}>
              {(table) => <TableRow table={table} onRows={() => props.onRows(table)} />}
            </For>
          </tbody>
        </Table>
      </Show>
    </section>
  );
}

function TableRow(props: { table: DiffTable; onRows: () => void }): JSX.Element {
  return (
    <Row>
      <Cell>{tableLabel(props.table)}</Cell>
      <Cell class="text-muted">{props.table.compare}</Cell>
      <Number value={props.table.added} tone="text-success-fg" />
      <Number value={props.table.removed} tone="text-danger-fg" />
      <Number value={props.table.changed} tone="text-warning-fg" />
      <Cell>
        <Show when={props.table.schema_changed} fallback={<span class="text-muted">same</span>}>
          {(columns) => <Badge variant="warning">{columns().join(", ")}</Badge>}
        </Show>
      </Cell>
      <Cell pinned>
        <Show when={touched(props.table)}>
          <Button size="sm" variant="ghost" onClick={props.onRows}>
            Rows
          </Button>
        </Show>
      </Cell>
    </Row>
  );
}

/** A zero is noise; it stays grey so the eye lands on the counts that are not zero. */
function Number(props: { value: number; tone: string }): JSX.Element {
  return (
    <Cell numeric class={props.value === 0 ? "text-muted" : props.tone}>
      {props.value}
    </Cell>
  );
}
