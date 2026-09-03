import type { JSX } from "@solidjs/web";
import type { StateDetail } from "@testate/shared";
import { For, Show, createMemo, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import { formatWhen } from "@/lib/format.ts";
import { STATE_KIND_LABEL, engineLabel } from "@/lib/labels.ts";
import { consistencyLabel, formatBytes, matchingTables } from "./states.format.ts";
import type { StatesPresenter } from "./states.presenter.ts";

type DetailAdapter = StateDetail["adapters"][number];

function qualified(table: { schema: string | null; name: string }): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

/**
 * One database of the state, folded: the line says what a person scans for (engine, rows, size,
 * whether the read was consistent), and the tables open on request into a box that scrolls and
 * filters, because a hundred tables is a list to search, not to read top to bottom.
 */
function AdapterSection(props: { adapter: DetailAdapter; open: boolean }): JSX.Element {
  const [needle, setNeedle] = createSignal("");
  const documents = (): boolean => props.adapter.engine === "mongodb";
  const tables = createMemo(() => matchingTables(props.adapter.tables, needle()));
  return (
    <details class="rounded-lg ring ring-line" open={props.open}>
      <summary class="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <span class="max-w-[16rem] truncate font-medium text-heading">
          {props.adapter.adapter_name}
        </span>
        <span class="text-muted">
          {engineLabel(props.adapter.engine)} {props.adapter.engine_version}
        </span>
        <span class="text-muted">
          {props.adapter.tables.length} {documents() ? "collections" : "tables"} ·{" "}
          {props.adapter.row_count} rows · {formatBytes(props.adapter.byte_count)}
        </span>
        <Show when={props.adapter.consistency !== "snapshot"}>
          <Badge variant="warning">{consistencyLabel(props.adapter.consistency)}</Badge>
        </Show>
        <Show when={props.adapter.warnings.length > 0}>
          <Icon name="triangle-alert" class="h-3.5 w-3.5 text-warning-fg" />
        </Show>
      </summary>
      <div class="grid gap-2 border-t border-line px-3 py-2">
        <Show when={props.adapter.warnings.length > 0}>
          <Banner variant="alert">
            {props.adapter.warnings.map((warning) => warning.message).join(" · ")}
          </Banner>
        </Show>
        <Show when={props.adapter.tables.length > 8}>
          <Input
            size="sm"
            placeholder={documents() ? "Find a collection..." : "Find a table..."}
            aria-label={documents() ? "Find a collection" : "Find a table"}
            value={needle()}
            onInput={(event) => setNeedle(event.currentTarget.value)}
          />
        </Show>
        <ul
          class="grid max-h-64 overflow-y-auto text-sm"
          aria-label={documents() ? "Collections" : "Tables"}
        >
          <For each={tables()}>
            {(table) => (
              <li class="flex items-center justify-between gap-3 py-1">
                <code class="min-w-0 truncate">{qualified(table)}</code>
                <span class="shrink-0 tabular-nums text-muted">
                  {table.rows} rows · {formatBytes(table.bytes)}
                </span>
              </li>
            )}
          </For>
          <Show when={tables().length === 0}>
            <li class="py-2 text-muted">Nothing matches.</li>
          </Show>
        </ul>
      </div>
    </details>
  );
}

/** What the state is, before what it holds: who took it, when, how big, tagged how. */
function Facts(props: { detail: StateDetail }): JSX.Element {
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <Badge variant={props.detail.kind === "init" ? "primary" : "outline"}>
        {STATE_KIND_LABEL[props.detail.kind]}
      </Badge>
      <span>{props.detail.actor.label}</span>
      <span aria-hidden="true">·</span>
      <span class="tabular-nums">{formatWhen(props.detail.created_at)}</span>
      <span aria-hidden="true">·</span>
      <span>
        {props.detail.adapters.length}{" "}
        {props.detail.adapters.length === 1 ? "database" : "databases"}
      </span>
      <span aria-hidden="true">·</span>
      <span class="tabular-nums">{formatBytes(props.detail.size_bytes)}</span>
      <Show when={props.detail.protected}>
        <Badge variant="outline">
          <Icon name="lock" class="h-3 w-3" />
          protected
        </Badge>
      </Show>
      <For each={props.detail.tags}>{(tag) => <Badge variant="info">{tag}</Badge>}</For>
    </div>
  );
}

export default function DetailDialog(props: { presenter: StatesPresenter }): JSX.Element {
  return (
    <Dialog
      open={props.presenter.detail() !== null}
      onClose={props.presenter.close}
      title={props.presenter.detail()?.name ?? ""}
      description={props.presenter.detail()?.notes ?? "No notes."}
      size="xl"
    >
      <Show when={props.presenter.detail()}>
        {(detail) => (
          <div class="grid gap-3">
            <Facts detail={detail()} />
            <div class="grid max-h-[60vh] gap-2 overflow-y-auto">
              <For each={detail().adapters}>
                {(adapter) => (
                  <AdapterSection adapter={adapter} open={detail().adapters.length === 1} />
                )}
              </For>
            </div>
            <DialogActions>
              <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                Close
              </Button>
            </DialogActions>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
