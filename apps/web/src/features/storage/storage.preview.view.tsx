import type { JSX } from "@solidjs/web";
import { For, Match, Show, Switch } from "solid-js";
import type { PreviewPayload } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { formatBytes } from "../states/states.format.ts";
import type { StoragePresenter } from "./storage.presenter.ts";

/** One entry's contents, by the three shapes the API renders server-side. */
function Payload(props: { payload: PreviewPayload }): JSX.Element {
  return (
    <Switch>
      <Match when={props.payload.kind === "csv" ? props.payload : null}>
        {(csv) => (
          <div class="overflow-auto">
            <Table>
              <thead>
                <tr>
                  <For each={csv().columns}>{(column) => <Head identifier>{column}</Head>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={csv().rows}>
                  {(row) => (
                    <Row>
                      <For each={row}>{(cell) => <Cell>{String(cell ?? "")}</Cell>}</For>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
          </div>
        )}
      </Match>
      <Match when={props.payload.kind === "json" ? props.payload : null}>
        {(json) => (
          <pre class="max-h-96 overflow-auto rounded-lg bg-fill p-3 text-xs">
            {JSON.stringify(json().content, null, 2)}
          </pre>
        )}
      </Match>
      <Match when={props.payload.kind === "text" ? props.payload : null}>
        {(text) => (
          <pre class="max-h-96 overflow-auto rounded-lg bg-fill p-3 text-xs">{text().content}</pre>
        )}
      </Match>
    </Switch>
  );
}

/** A file's contents, opened from the listing; a sandboxed frame for binaries, rendered text otherwise. */
export function PreviewDialog(props: { presenter: StoragePresenter }): JSX.Element {
  return (
    <Show when={props.presenter.preview()}>
      {(preview) => (
        <Dialog
          open
          size="xl"
          onClose={props.presenter.closePreview}
          title={preview().entry.name}
          description={`${formatBytes(preview().entry.size_bytes ?? 0)} · ${preview().entry.modified_at ?? ""}`}
        >
          <div class="grid gap-3">
            <Show when={props.presenter.binaryUrl()}>
              {(url) => (
                <iframe
                  title={preview().entry.name}
                  sandbox=""
                  class="h-96 w-full rounded-lg bg-fill"
                  src={url()}
                />
              )}
            </Show>
            <Show when={props.presenter.payload()}>
              {(payload) => (
                <>
                  <Show when={payload().truncated}>
                    <Badge variant="warning">truncated</Badge>
                  </Show>
                  <Payload payload={payload()} />
                </>
              )}
            </Show>
            <DialogActions>
              <a
                class="text-sm underline"
                href={props.presenter.downloadUrl(preview().entry)}
                download={preview().entry.name}
              >
                Download
              </a>
              <Button type="button" variant="ghost" onClick={() => props.presenter.closePreview()}>
                Close
              </Button>
            </DialogActions>
          </div>
        </Dialog>
      )}
    </Show>
  );
}
