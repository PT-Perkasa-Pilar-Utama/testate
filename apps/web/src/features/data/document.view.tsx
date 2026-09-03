import type { JSX } from "@solidjs/web";
import type { JsonObject } from "@testate/shared";
import { For, Show, createMemo, createSignal } from "solid-js";

import { TableToolbar } from "@/components/table.tsx";
import { documentId, fieldLines } from "./document.presenter.ts";
import type { FieldLine } from "./document.presenter.ts";
import { ExportLinks, FilterBar, Pager } from "./grid-toolbar.view.tsx";
import type { GridPresenter } from "./grid.presenter.ts";

function Line(props: { line: FieldLine }): JSX.Element {
  const indent = (): string => `${props.line.depth * 1.25}rem`;
  return (
    <div class="flex flex-wrap items-baseline gap-x-2 py-0.5" style={{ "padding-left": indent() }}>
      <code class="text-muted">{props.line.key}:</code>
      <Show
        when={props.line.text !== null}
        fallback={<span class="text-muted">{props.line.kind === "array" ? "[…]" : "{…}"}</span>}
      >
        <span class="break-all">{props.line.text}</span>
      </Show>
    </div>
  );
}

/**
 * A collection the way a document store's own console shows it: the documents down the left,
 * one picked, its fields on the right. No grid, no write mode, no fixtures: those are the
 * Tabular tier's, and a document has no columns to line up in the first place.
 */
export default function DocumentView(props: { presenter: GridPresenter }): JSX.Element {
  const rows = (): JsonObject[] => props.presenter.page.value().data;
  const [pickedId, setPickedId] = createSignal<string | null>(null);
  // Derived, never written from a computation: the pick survives a page refresh while its
  // document is still on the page, and falls back to the first one when it is not.
  const picked = createMemo(
    (): JsonObject | null =>
      rows().find((row) => documentId(row) === pickedId()) ?? rows()[0] ?? null
  );
  const lines = createMemo((): FieldLine[] => {
    const current = picked();
    return current === null ? [] : fieldLines(current);
  });
  return (
    <>
      <TableToolbar actions={<ExportLinks presenter={props.presenter} />}>
        <FilterBar
          presenter={props.presenter}
          columns={props.presenter.page.value().columns.map((column) => column.name)}
        />
      </TableToolbar>
      <div class="grid gap-px overflow-hidden rounded-lg bg-line ring ring-line md:grid-cols-[18rem_1fr]">
        <ul role="list" aria-label="Documents" class="grid content-start bg-surface">
          <Show
            when={rows().length > 0}
            fallback={
              <li class="px-3 py-6 text-center text-sm text-muted">
                {props.presenter.filters().length > 0
                  ? "No documents match your filters."
                  : "This collection has no documents yet."}
              </li>
            }
          >
            <For each={rows()}>
              {(row) => (
                <li>
                  <button
                    type="button"
                    class={[
                      "block w-full truncate px-3 py-2 text-left font-mono text-sm hover:bg-fill",
                      picked() === row ? "bg-fill text-heading" : "text-body",
                    ]}
                    aria-current={picked() === row ? "true" : undefined}
                    onClick={() => setPickedId(documentId(row))}
                  >
                    {documentId(row)}
                  </button>
                </li>
              )}
            </For>
          </Show>
        </ul>
        <section aria-label="Fields of the document" class="min-h-48 bg-surface px-4 py-3 text-sm">
          <Show when={picked()} fallback={<p class="text-muted">Pick a document to read it.</p>}>
            {(row) => (
              <>
                <h3 class="mb-2 font-mono text-heading">{documentId(row())}</h3>
                <For each={lines()}>{(line) => <Line line={line} />}</For>
              </>
            )}
          </Show>
        </section>
      </div>
      <Pager presenter={props.presenter} noun="documents" />
    </>
  );
}
