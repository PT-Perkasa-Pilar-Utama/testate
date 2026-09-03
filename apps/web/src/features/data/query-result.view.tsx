import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { QueryResult } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Icon from "@/components/icon.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import EmptyState from "@/components/empty-state.tsx";
import { cellText } from "./grid.presenter.ts";

const ENFORCEMENT_VARIANT = {
  transaction: "success",
  credential: "success",
  filter: "warning",
} as const;
const ENFORCEMENT_TEXT = {
  transaction: "read-only transaction",
  credential: "read-only credential",
  filter: "application filter only",
} as const;

/** The console's output: what ran, how it was kept read-only, and the rows it answered with. */
export default function ResultTable(props: { result: QueryResult }): JSX.Element {
  return (
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={ENFORCEMENT_VARIANT[props.result.read_only_enforcement]}>
          {ENFORCEMENT_TEXT[props.result.read_only_enforcement]}
        </Badge>
        <span class="text-muted">
          {props.result.rows.length} row(s) · {props.result.duration_ms} ms
        </span>
        <Show when={props.result.truncated.rows}>
          <Badge variant="warning">row cap hit</Badge>
        </Show>
        <Show when={props.result.truncated.bytes}>
          <Badge variant="warning">byte budget hit</Badge>
        </Show>
        <Show when={props.result.truncated.time}>
          <Badge variant="warning">time budget hit</Badge>
        </Show>
        <Show when={props.result.masked_columns.length > 0}>
          <span class="flex items-center gap-1 text-muted">
            <Icon name="eye-off" class="h-3 w-3" />
            masked: {props.result.masked_columns.join(", ")}
          </span>
        </Show>
      </div>
      <Show
        when={props.result.rows.length > 0}
        fallback={
          <EmptyState icon="circle-check" title="Ran clean, nothing to show">
            The query ran and answered with zero rows. Check the query above.
          </EmptyState>
        }
      >
        <Table>
          <thead>
            <tr>
              <For each={props.result.columns}>
                {(column) => <Head identifier>{column.name}</Head>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.result.rows}>
              {(row) => (
                <Row>
                  <For each={props.result.columns}>
                    {(column) => <Cell>{cellText(row[column.name])}</Cell>}
                  </For>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
      </Show>
    </div>
  );
}
