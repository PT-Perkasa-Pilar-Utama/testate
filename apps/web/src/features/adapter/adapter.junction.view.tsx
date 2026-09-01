import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Adapter, Entry, Introspection } from "@testate/shared";

import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Cell, EmptyRow, Head, Row, Table, Truncated } from "@/components/table.tsx";
import { formatWhen } from "@/lib/format.ts";
import { ENTRY_KIND_LABEL } from "@/lib/labels.ts";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { formatBytes } from "../states/states.format.ts";

/**
 * The reason this screen exists: leave it for the console, the policies, or the storage browser.
 * Everything else on the page (status, connection identity) is context for this decision, so it
 * sits above it and the buttons that make it stay grouped and legible.
 */
export function JunctionToolbar(props: { adapter: Adapter; base: string }): JSX.Element {
  const a = (): Adapter => props.adapter;
  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-base font-semibold text-heading">
        {a().tier === "files" ? "Files" : "Tables"}
      </h3>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={a().kind === "database"}>
          <Button size="sm" variant="secondary" onClick={() => navigate(`${props.base}/query`)}>
            <Icon name="terminal" class="h-3.5 w-3.5" />
            Query console
          </Button>
        </Show>
        <Show when={a().tier === "tabular" && hasRole("qa")}>
          <Button size="sm" variant="secondary" onClick={() => navigate(`${props.base}/imports`)}>
            <Icon name="upload" class="h-3.5 w-3.5" />
            Import a file
          </Button>
        </Show>
        {/* UI_REWORK.md: masks stay load-bearing but the screen hides behind admin. */}
        <Show when={a().tier === "tabular" && hasRole("admin")}>
          <Button size="sm" variant="secondary" onClick={() => navigate(`${props.base}/masks`)}>
            <Icon name="shield" class="h-3.5 w-3.5" />
            Masks
          </Button>
        </Show>
        <Show when={a().kind === "storage"}>
          <Button size="sm" variant="secondary" onClick={() => navigate(`${props.base}/files`)}>
            <Icon name="folder-open" class="h-3.5 w-3.5" />
            Browse files
          </Button>
        </Show>
      </div>
    </div>
  );
}

function qualified(table: { schema: string | null; name: string }): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

export function TablesView(props: { schema: Introspection; base: string }): JSX.Element {
  const tablePath = (name: string): string => `${props.base}/tables/${encodeURIComponent(name)}`;
  const open = (event: MouseEvent, name: string): void => {
    event.preventDefault();
    navigate(tablePath(name));
  };
  return (
    <Table>
      <thead>
        <tr>
          <Head>Table</Head>
          <Head numeric>Rows (est.)</Head>
          <Head numeric>Columns</Head>
          <Head>Primary key</Head>
        </tr>
      </thead>
      <tbody>
        <Show
          when={props.schema.tables.length > 0}
          fallback={
            <EmptyRow>
              No tables found. Retest the connection, or open Edit adapter to check what is
              excluded.
            </EmptyRow>
          }
        >
          <For each={props.schema.tables}>
            {(table) => (
              <Row>
                <Cell>
                  <a
                    class="hover:underline"
                    href={href(tablePath(qualified(table)))}
                    onClick={(event) => open(event, qualified(table))}
                  >
                    <code class="block max-w-[20rem] truncate" title={qualified(table)}>
                      {qualified(table)}
                    </code>
                  </a>
                </Cell>
                <Cell numeric>{table.row_estimate}</Cell>
                <Cell numeric>{table.columns.length}</Cell>
                <Cell>
                  <Truncated>{table.primary_key?.join(", ") ?? "none"}</Truncated>
                </Cell>
              </Row>
            )}
          </For>
        </Show>
      </tbody>
    </Table>
  );
}

export function FilesView(props: { entries: Entry[] }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Name</Head>
          <Head>Kind</Head>
          <Head numeric>Size</Head>
          <Head>Modified</Head>
        </tr>
      </thead>
      <tbody>
        <Show
          when={props.entries.length > 0}
          fallback={
            <EmptyRow>
              No files found at the connection root. Open Browse files to look in a subfolder, or
              check the storage adapter's connection.
            </EmptyRow>
          }
        >
          <For each={props.entries}>
            {(entry) => (
              <Row>
                <Cell>
                  <Truncated class="max-w-[24rem]">{entry.name}</Truncated>
                </Cell>
                <Cell>{ENTRY_KIND_LABEL[entry.kind]}</Cell>
                <Cell numeric>
                  {entry.size_bytes === null ? "" : formatBytes(entry.size_bytes)}
                </Cell>
                <Cell>{entry.modified_at === null ? "" : formatWhen(entry.modified_at)}</Cell>
              </Row>
            )}
          </For>
        </Show>
      </tbody>
    </Table>
  );
}
