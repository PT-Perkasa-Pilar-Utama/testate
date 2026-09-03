import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { DiffRow, JsonObject } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import JsonView from "@/components/json-view.tsx";
import { DIFF_OP_LABEL } from "@/lib/labels.ts";
import { plain } from "@/lib/plain-value.ts";
import { cellText } from "../data/grid.presenter.ts";
import { OP_TONE } from "./diff.rows.view.tsx";

function idOf(row: DiffRow): string {
  return Array.isArray(row.k) ? row.k.map(cellText).join(", ") : row.k;
}

function Side(props: { title: string; document: JsonObject }): JSX.Element {
  return (
    <div class="grid content-start gap-1">
      <span class="text-xs text-muted">{props.title}</span>
      <div class="overflow-x-auto rounded-lg bg-sunken px-3 py-2 ring ring-line">
        <JsonView value={plain(props.document)} />
      </div>
    </div>
  );
}

/**
 * A document store's moved documents: each one as the JSON it is, both sides beside each other,
 * the changed fields named above. Never a grid: a document has no columns.
 */
export default function DocumentPairs(props: { rows: DiffRow[] }): JSX.Element {
  return (
    <>
      <ul class="grid gap-3" aria-label="Documents that moved">
        <For each={props.rows}>
          {(row) => (
            <li class="grid gap-2 rounded-lg bg-surface p-3 ring ring-line">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={OP_TONE[row.op]}>{DIFF_OP_LABEL[row.op]}</Badge>
                <code class="text-heading">{idOf(row)}</code>
                <Show when={(row.changed_columns ?? []).length > 0}>
                  <span class="text-muted">
                    changed: <code>{(row.changed_columns ?? []).join(", ")}</code>
                  </span>
                </Show>
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                <Show when={row.before}>
                  {(before) => <Side title="before" document={before()} />}
                </Show>
                <Show when={row.after}>{(after) => <Side title="after" document={after()} />}</Show>
              </div>
            </li>
          )}
        </For>
      </ul>
      <p class="text-sm text-muted">The first 100 documents, masked to your role.</p>
    </>
  );
}
