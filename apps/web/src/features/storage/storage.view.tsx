import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import { Errored, For, Loading, Show, Switch, Match } from "solid-js";
import type { Entry, PreviewPayload } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  Table,
  TableFooter,
  TableToolbar,
} from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { formatBytes } from "../states/states.format.ts";
import { createStoragePresenter } from "./storage.presenter.ts";
import type { StoragePresenter } from "./storage.presenter.ts";

function Payload(props: { payload: PreviewPayload }): JSX.Element {
  return (
    <Switch>
      <Match when={props.payload.kind === "csv" ? props.payload : null}>
        {(csv) => (
          <div class="overflow-auto">
            <Table>
              <thead>
                <tr>
                  <For each={csv().columns}>{(column) => <Head>{column}</Head>}</For>
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
          <pre class="max-h-96 overflow-auto rounded-lg bg-kumo-fill p-3 text-xs">
            {JSON.stringify(json().content, null, 2)}
          </pre>
        )}
      </Match>
      <Match when={props.payload.kind === "text" ? props.payload : null}>
        {(text) => (
          <pre class="max-h-96 overflow-auto rounded-lg bg-kumo-fill p-3 text-xs">
            {text().content}
          </pre>
        )}
      </Match>
    </Switch>
  );
}

function PreviewDialog(props: { presenter: StoragePresenter }): JSX.Element {
  return (
    <Show when={props.presenter.preview()}>
      {(preview) => (
        <Dialog
          open
          size="xl"
          onClose={() => props.presenter.closePreview()}
          title={preview().entry.name}
          description={`${formatBytes(preview().entry.size_bytes ?? 0)} · ${preview().entry.modified_at ?? ""}`}
        >
          <div class="grid gap-3">
            <Show when={props.presenter.binaryUrl()}>
              {(url) => (
                <iframe
                  title={preview().entry.name}
                  sandbox=""
                  class="h-96 w-full rounded-lg bg-kumo-fill"
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
            <div class="flex justify-end gap-2">
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
            </div>
          </div>
        </Dialog>
      )}
    </Show>
  );
}

function EntryRow(props: { presenter: StoragePresenter; entry: Entry }): JSX.Element {
  const openDir = (event: MouseEvent): void => {
    event.preventDefault();
    props.presenter.open(props.entry.path);
  };
  return (
    <Row>
      <Cell>
        <Show
          when={props.entry.kind === "directory"}
          fallback={
            <button
              type="button"
              class="cursor-pointer hover:underline"
              onClick={() => void props.presenter.openPreview(props.entry)}
            >
              {props.entry.name}
            </button>
          }
        >
          <a class="font-medium hover:underline" href="#" onClick={openDir}>
            {props.entry.name}/
          </a>
        </Show>
      </Cell>
      <Cell numeric>
        {props.entry.size_bytes === null ? "" : formatBytes(props.entry.size_bytes)}
      </Cell>
      <Cell class="whitespace-nowrap">
        {props.entry.modified_at === null ? "" : formatWhen(props.entry.modified_at)}
      </Cell>
      <Cell pinned>
        <Show when={props.entry.kind === "file"}>
          <a
            class={buttonClass("ghost", "sm")}
            href={props.presenter.downloadUrl(props.entry)}
            download={props.entry.name}
          >
            Download
          </a>
        </Show>
      </Cell>
    </Row>
  );
}

/** Folder browsing over a storage adapter (api 11, stories 94-97). */
export default function StorageView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createStoragePresenter(
    () => props.slug,
    () => props.id
  );
  return (
    <section class="grid gap-4">
      <h2 class="flex flex-wrap items-center gap-1 text-lg font-semibold">
        <AdapterCrumb slug={props.slug} id={props.id} />
        <span>/</span>
        <button
          type="button"
          class="cursor-pointer hover:underline"
          onClick={() => presenter.open("")}
        >
          root
        </button>
        <For each={presenter.crumbs()}>
          {(crumb) => (
            <>
              <span>/</span>
              <button
                type="button"
                class="cursor-pointer hover:underline"
                onClick={() => presenter.open(crumb.path)}
              >
                {crumb.name}
              </button>
            </>
          )}
        </For>
      </h2>
      <TableToolbar
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={presenter.path() === ""}
              onClick={() => presenter.up()}
            >
              Up
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={presenter.depth() === 0}
              onClick={() => presenter.previous()}
            >
              Previous
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          class="w-56!"
          placeholder="filter by name"
          value={presenter.q()}
          onInput={(event) => presenter.setQ(event.currentTarget.value)}
        />
      </TableToolbar>
      <Show when={presenter.changedKey()}>
        {(fingerprint) => (
          <Banner variant="alert">
            The SFTP host key changed: {fingerprint()}.{" "}
            <Show when={hasRole("qa")}>
              <Button size="sm" variant="secondary" onClick={() => void presenter.acceptHostKey()}>
                Accept the new key
              </Button>
            </Show>
          </Banner>
        )}
      </Show>
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-kumo-subtle">Listing...</p>}>
          <Table>
            <thead>
              <tr>
                <Head>Name</Head>
                <Head numeric>Size</Head>
                <Head>Modified</Head>
                <Head pinned />
              </tr>
            </thead>
            <tbody>
              <Show
                when={presenter.page.value().data.length > 0}
                fallback={<EmptyRow>Nothing here. This directory is empty.</EmptyRow>}
              >
                <For each={presenter.page.value().data}>
                  {(entry) => <EntryRow presenter={presenter} entry={entry} />}
                </For>
              </Show>
            </tbody>
          </Table>
          <TableFooter
            shown={presenter.page.value().data.length}
            noun="entries"
            hasMore={presenter.page.value().page.next_cursor !== null}
          >
            <Show when={presenter.page.value().page.next_cursor !== null}>
              <Button size="sm" variant="secondary" onClick={() => presenter.next()}>
                Next page
              </Button>
            </Show>
          </TableFooter>
        </Loading>
      </Errored>
      <PreviewDialog presenter={presenter} />
    </section>
  );
}
