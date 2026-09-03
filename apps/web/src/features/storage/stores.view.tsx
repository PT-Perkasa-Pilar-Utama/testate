import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show, createSignal } from "solid-js";
import type { AdapterWithProject } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import EmptyState from "@/components/empty-state.tsx";
import PageHeader from "@/components/page-header.tsx";
import { Cell, Head, Row, Table, TableFooter } from "@/components/table.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { ADAPTER_MODE_LABEL, ADAPTER_STATUS_LABEL, ENGINE_LABEL } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { hasRole } from "@/lib/session.ts";
import { CreateDialog } from "../adapters/adapters.create.view.tsx";
import { createAdaptersPresenter } from "../adapters/adapters.presenter.ts";
import { projectsModel } from "../projects/projects.model.ts";
import { storageModel } from "./storage.model.ts";

/**
 * One button, and the project is picked inside the dialog: a select beside the button was a
 * second control to understand before the first, and with a hundred projects it was the wrong
 * one to leave open on the page. The presenter's slug is the signal, so the dialog follows the
 * pick without being rebuilt.
 */
function NewStore(props: { onCreated: () => void }): JSX.Element {
  const projects = createRefreshable(() => projectsModel.list());
  const [picked, setPicked] = createSignal("");
  const slug = (): string => picked() || (projects.value()[0]?.slug ?? "");
  const presenter = createAdaptersPresenter(slug, () => props.onCreated());
  const options = () =>
    projects.value().map((project) => ({ value: project.slug, label: project.name }));
  return (
    <Loading fallback={<span />}>
      <Button
        variant="primary"
        disabled={options().length === 0}
        title={options().length === 0 ? "Create a project first" : undefined}
        onClick={() => presenter.openCreate()}
      >
        <Icon name="plus" class="h-4 w-4" />
        New storage adapter
      </Button>
      <CreateDialog
        presenter={presenter}
        kind="storage"
        project={{ options: options(), value: slug(), onChange: setPicked }}
      />
    </Loading>
  );
}

/** Stores by project, each project once, in the order the projects list them. */
function byProject(
  stores: AdapterWithProject[]
): { slug: string; name: string; stores: AdapterWithProject[] }[] {
  const groups = new Map<string, { slug: string; name: string; stores: AdapterWithProject[] }>();
  for (const store of stores) {
    const group = groups.get(store.project_slug) ?? {
      slug: store.project_slug,
      name: store.project_name,
      stores: [],
    };
    group.stores.push(store);
    groups.set(store.project_slug, group);
  }
  return [...groups.values()];
}

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
        description="Object storage (S3-compatible), SFTP and FTP, across every project you can see."
        actions={
          <Show when={hasRole("qa")}>
            <NewStore onCreated={() => stores.refresh()} />
          </Show>
        }
      />
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-muted">Listing...</p>}>
          <Show
            when={stores.value().length > 0}
            fallback={
              <EmptyState icon="folder" title="No file stores yet">
                Add one with the button above; it appears here under its project.
              </EmptyState>
            }
          >
            <div class="grid gap-5">
              <For each={byProject(stores.value())}>
                {(group) => (
                  <section class="grid gap-2">
                    <h3 class="flex items-baseline gap-2 text-sm font-medium text-heading">
                      <a class="hover:underline" href={href(`/projects/${group.slug}`)}>
                        {group.name}
                      </a>
                      <span class="text-xs text-muted">{group.stores.length}</span>
                    </h3>
                    <Table>
                      <thead>
                        <tr>
                          <Head>Name</Head>
                          <Head>Engine</Head>
                          <Head>Mode</Head>
                          <Head>Status</Head>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={group.stores}>{(store) => <StoreRow store={store} />}</For>
                      </tbody>
                    </Table>
                  </section>
                )}
              </For>
            </div>
            <TableFooter shown={stores.value().length} noun="file stores" hasMore={false} />
          </Show>
        </Loading>
      </Errored>
    </section>
  );
}
