import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import { Errored, For, Loading, Show } from "solid-js";
import type { Entry } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  Table,
  TableFooter,
  TableSearch,
  TableToolbar,
} from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { formatBytes } from "../states/states.format.ts";
import { PreviewDialog } from "./storage.preview.view.tsx";
import { createStoragePresenter } from "./storage.presenter.ts";
import type { StoragePresenter } from "./storage.presenter.ts";

/**
 * A path bar, not a heading: the adapter you're in, then Up, then every folder between here and
 * root. The current folder is plain text, the way GitHub's own breadcrumb never links to itself.
 */
function PathBar(props: { presenter: StoragePresenter; slug: string; id: string }): JSX.Element {
  const atRoot = (): boolean => props.presenter.path() === "";
  return (
    <div class="flex flex-wrap items-center gap-1.5 text-base">
      <AdapterCrumb slug={props.slug} id={props.id} />
      <Icon name="chevron-right" class="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      <Button
        size="xs"
        variant="ghost"
        disabled={atRoot()}
        title="Up one level"
        aria-label="Up one level"
        onClick={() => props.presenter.up()}
      >
        <Icon name="arrow-left" class="h-3.5 w-3.5" />
      </Button>
      <Show
        when={!atRoot()}
        fallback={
          <span class="inline-flex items-center gap-1 font-medium text-heading">
            <Icon name="house" class="h-3.5 w-3.5" />
            root
          </span>
        }
      >
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 text-muted hover:text-body hover:underline"
          onClick={() => props.presenter.open("")}
        >
          <Icon name="house" class="h-3.5 w-3.5" />
          root
        </button>
      </Show>
      <For each={props.presenter.crumbs()}>
        {(crumb, index) => (
          <>
            <Icon name="chevron-right" class="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            <Show
              when={index() < props.presenter.crumbs().length - 1}
              fallback={<span class="font-medium text-heading">{crumb.name}</span>}
            >
              <button
                type="button"
                class="cursor-pointer text-muted hover:text-body hover:underline"
                onClick={() => props.presenter.open(crumb.path)}
              >
                {crumb.name}
              </button>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

/** One entry; a folder icon or a file icon says what a click does before the click happens. */
function EntryRow(props: { presenter: StoragePresenter; entry: Entry }): JSX.Element {
  return (
    <Row>
      <Cell>
        <Show
          when={props.entry.kind === "directory"}
          fallback={
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-2 hover:underline"
              onClick={() => void props.presenter.openPreview(props.entry)}
            >
              <Icon name="file-text" class="h-4 w-4 shrink-0 text-muted" />
              {props.entry.name}
            </button>
          }
        >
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-2 font-medium hover:underline"
            onClick={() => props.presenter.open(props.entry.path)}
          >
            <Icon name="folder" class="h-4 w-4 shrink-0 text-muted" />
            {props.entry.name}
          </button>
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
            <Icon name="download" class="h-3.5 w-3.5" />
            Download
          </a>
        </Show>
      </Cell>
    </Row>
  );
}

/** What the empty row means: an honestly empty folder, or a filter that matched nothing. */
function EmptyMessage(props: { q: string }): JSX.Element {
  return (
    <Show when={props.q !== ""} fallback={<>Nothing here. This directory is empty.</>}>
      No files match "{props.q}".
    </Show>
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
      <PathBar presenter={presenter} slug={props.slug} id={props.id} />
      <TableToolbar>
        <TableSearch
          label="Search files"
          placeholder="name"
          value={presenter.q()}
          onInput={(value) => presenter.setQ(value)}
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
        <Loading fallback={<p class="text-muted">Listing...</p>}>
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
                fallback={
                  <EmptyRow>
                    <EmptyMessage q={presenter.q()} />
                  </EmptyRow>
                }
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
            <Show when={presenter.depth() > 0}>
              <Button size="sm" variant="secondary" onClick={() => presenter.previous()}>
                Previous page
              </Button>
            </Show>
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
