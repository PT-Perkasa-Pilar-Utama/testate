import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show } from "solid-js";
import type { AdapterWithProject } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import EmptyState from "@/components/empty-state.tsx";
import PageHeader from "@/components/page-header.tsx";
import { Cell, EmptyRow, Head, Row, Table, TableFooter } from "@/components/table.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { ADAPTER_MODE_LABEL, ADAPTER_STATUS_LABEL, ENGINE_LABEL } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import { storageModel } from "./storage.model.ts";

const TONE = { ok: "success", error: "error", disabled: "warning" } as const;

function StoreRow(props: { store: AdapterWithProject }): JSX.Element {
  const path = (): string =>
    `/projects/${props.store.project_slug}/adapters/${props.store.id}/files`;
  return (
    <Row>
      <Cell>
        <a class="font-medium hover:underline" href={href(path())}>
          {props.store.name}
        </a>
      </Cell>
      <Cell>
        <a class="text-muted hover:underline" href={href(`/projects/${props.store.project_slug}`)}>
          {props.store.project_name}
        </a>
      </Cell>
      <Cell>{ENGINE_LABEL[props.store.engine]}</Cell>
      <Cell>{ADAPTER_MODE_LABEL[props.store.mode]}</Cell>
      <Cell>
        <Badge variant={TONE[props.store.status]}>{ADAPTER_STATUS_LABEL[props.store.status]}</Badge>
      </Cell>
    </Row>
  );
}

/**
 * Every file store on the instance, in one place.
 *
 * A file store is not a project primitive: a snapshot lists database adapters only, so a store
 * never enters a state, never gets checked out and never appears in a diff. It still belongs to a
 * project, which is why the project is a column rather than the route
 *.
 */
export default function StoresView(): JSX.Element {
  const stores = createRefreshable(() => storageModel.stores());
  return (
    <section class="grid gap-4">
      <PageHeader
        eyebrow="Workspace"
        title="Storage"
        description="S3, SFTP and FTP adapters, across every project you can see."
      />
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-muted">Listing...</p>}>
          <Show
            when={stores.value().length > 0}
            fallback={
              <EmptyState icon="folder" title="No file stores yet">
                Add one from a project's Databases tab and it appears here.
              </EmptyState>
            }
          >
            <Table>
              <thead>
                <tr>
                  <Head>Name</Head>
                  <Head>Project</Head>
                  <Head>Engine</Head>
                  <Head>Mode</Head>
                  <Head>Status</Head>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={stores.value().length > 0}
                  fallback={<EmptyRow>Nothing here.</EmptyRow>}
                >
                  <For each={stores.value()}>{(store) => <StoreRow store={store} />}</For>
                </Show>
              </tbody>
            </Table>
            <TableFooter shown={stores.value().length} noun="file stores" hasMore={false} />
          </Show>
        </Loading>
      </Errored>
    </section>
  );
}
