import type { JSX } from "@solidjs/web";
import type { JsonObject, JsonValue } from "@testate/shared";
import { For, Show, createMemo, createSignal } from "solid-js";

import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { TableToolbar } from "@/components/table.tsx";
import { Column, Empty, Item } from "./document.columns.view.tsx";
import { at, documentId, entriesOf, fitting } from "./document.presenter.ts";
import { ExportLinks, FilterBar } from "./grid-toolbar.view.tsx";
import type { GridPresenter } from "./grid.presenter.ts";

type Props = {
  presenter: GridPresenter;
  slug: string;
  id: string;
  table: string;
  /** What a click on a collection does: the grid route navigates, the adapter page swaps in place. */
  onCollection: (name: string) => void;
};
/** Where the reader is: a document, and the keys opened inside it, one column each. */
type Pick = { id: string | null; path: string[] };

/** The path bar: every level opened so far, each a way back to it. */
function PathBar(props: {
  browser: Props;
  picked: JsonObject | null;
  path: string[];
  onJump: (depth: number) => void;
}): JSX.Element {
  const crumb = "truncate max-w-[12rem] hover:underline";
  return (
    <nav
      aria-label="Document path"
      class="flex items-center gap-1 border-b border-line px-3 py-2 font-mono text-xs text-muted"
    >
      <Icon name="database" class="h-3.5 w-3.5 shrink-0" />
      <span class="truncate">{props.browser.presenter.adapter.value().name}</span>
      <span aria-hidden="true">›</span>
      <button type="button" class={crumb} onClick={() => props.onJump(-1)}>
        {props.browser.table}
      </button>
      <Show when={props.picked}>
        {(row) => (
          <>
            <span aria-hidden="true">›</span>
            <button type="button" class={[crumb, "text-heading"]} onClick={() => props.onJump(0)}>
              {documentId(row())}
            </button>
          </>
        )}
      </Show>
      <For each={props.path}>
        {(key, index) => (
          <>
            <span aria-hidden="true">›</span>
            <button
              type="button"
              class={[crumb, "text-heading"]}
              onClick={() => props.onJump(index() + 1)}
            >
              {key}
            </button>
          </>
        )}
      </For>
    </nav>
  );
}

/** Documents of the collection, with the page controls in the foot. */
function DocumentsFoot(props: { presenter: GridPresenter }): JSX.Element {
  const page = (): { next_cursor: string | null } => props.presenter.page.value().page;
  return (
    <div class="flex items-center justify-between gap-2 text-xs text-muted">
      <span>{props.presenter.page.value().data.length} documents</span>
      <span class="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={props.presenter.depth() === 0}
          onClick={() => props.presenter.previous()}
          aria-label="Previous page"
        >
          <Icon name="chevron-left" class="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={page().next_cursor === null}
          onClick={() => props.presenter.next()}
          aria-label="Next page"
        >
          <Icon name="chevron-right" class="h-3.5 w-3.5" />
        </Button>
      </span>
    </div>
  );
}

/** The fields of one container; a nested one is a row that opens the next column. */
function FieldsColumn(props: {
  title: string;
  value: JsonValue;
  opened: string | undefined;
  last: boolean;
  onOpen: (key: string) => void;
}): JSX.Element {
  const entries = createMemo(() => entriesOf(props.value));
  return (
    <Column title={props.title} icon="file-text" last={props.last}>
      <Show when={entries().length > 0} fallback={<Empty>Nothing in here.</Empty>}>
        <For each={entries()}>
          {(field) => (
            <Item
              label=""
              mono
              selected={props.opened === field.key}
              opens={field.kind !== "value"}
              onClick={() => (field.kind === "value" ? undefined : props.onOpen(field.key))}
              detail={
                <>
                  <span class="text-muted">{field.key}:</span>{" "}
                  <span class={field.kind === "value" ? "text-body" : "text-muted"}>
                    {field.text ?? (field.kind === "array" ? "[…]" : "{…}")}
                  </span>
                </>
              }
            />
          )}
        </For>
      </Show>
    </Column>
  );
}

/**
 * A collection the way the Firestore console shows a database: columns side by side, each
 * level opening the next. Collections, then the documents of the picked one, then the fields of
 * the picked document, then any nested object or array opened inside it, one column per level,
 * with a path bar on top to jump back to any of them.
 */
export default function DocumentBrowser(props: Props): JSX.Element {
  const rows = (): JsonObject[] => props.presenter.page.value().data;
  const [pick, setPick] = createSignal<Pick>({ id: null, path: [] });
  // Derived, never written from a computation: the pick survives a page refresh while its
  // document is still on the page, and falls back to the first one when it is not.
  const picked = createMemo(
    (): JsonObject | null =>
      rows().find((row) => documentId(row) === pick().id) ?? rows()[0] ?? null
  );
  const path = createMemo((): string[] => {
    const row = picked();
    return row === null ? [] : fitting(row, pick().path);
  });
  const jump = (depth: number): void => {
    if (depth < 0) setPick({ id: null, path: [] });
    else setPick({ id: pick().id, path: path().slice(0, depth) });
  };
  const open = (depth: number, key: string): void => {
    setPick({ id: documentId(picked() ?? {}), path: [...path().slice(0, depth), key] });
  };
  return (
    <>
      <TableToolbar actions={<ExportLinks presenter={props.presenter} />}>
        <FilterBar
          presenter={props.presenter}
          columns={props.presenter.page.value().columns.map((column) => column.name)}
        />
      </TableToolbar>
      <div class="overflow-hidden rounded-lg bg-surface ring ring-line">
        <PathBar browser={props} picked={picked()} path={path()} onJump={jump} />
        <div class="flex divide-x divide-line overflow-x-auto">
          <Column title={props.presenter.adapter.value().name} icon="database">
            <For each={props.presenter.collections()}>
              {(name) => (
                <Item
                  label={name}
                  mono
                  selected={name === props.table}
                  opens
                  onClick={() => props.onCollection(name)}
                />
              )}
            </For>
          </Column>
          <Column
            title={props.table}
            icon="list-tree"
            foot={<DocumentsFoot presenter={props.presenter} />}
          >
            <Show
              when={rows().length > 0}
              fallback={
                <Empty>
                  {props.presenter.filters().length > 0
                    ? "No documents match your filters."
                    : "This collection has no documents yet."}
                </Empty>
              }
            >
              <ul role="list" aria-label="Documents">
                <For each={rows()}>
                  {(row) => (
                    <li>
                      <Item
                        label={documentId(row)}
                        mono
                        selected={picked() === row}
                        opens
                        onClick={() => setPick({ id: documentId(row), path: [] })}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Column>
          <Show when={picked()}>
            {(row) => (
              <section aria-label="Fields of the document" class="contents">
                <FieldsColumn
                  title={documentId(row())}
                  value={row()}
                  opened={path()[0]}
                  last={path().length === 0}
                  onOpen={(key) => open(0, key)}
                />
                <For each={path()}>
                  {(key, index) => (
                    <FieldsColumn
                      title={key}
                      value={at(row(), path().slice(0, index() + 1)) ?? null}
                      opened={path()[index() + 1]}
                      last={index() === path().length - 1}
                      onOpen={(next) => open(index() + 1, next)}
                    />
                  )}
                </For>
              </section>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}
