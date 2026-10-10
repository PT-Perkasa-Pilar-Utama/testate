import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show } from "solid-js";
import type { AdapterWithProject } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import EmptyState from "@/components/empty-state.tsx";
import InspectBadge from "@/components/inspect-badge.tsx";
import PageHeader from "@/components/page-header.tsx";
import { Cell, Head, Row, Table, TableFooter } from "@/components/table.tsx";
import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import { ADAPTER_STATUS_LABEL, ENGINE_LABEL } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { STATUS_VARIANT } from "../adapters/adapters.fields.ts";
import { storeGroups } from "../storage/storage.groups.ts";
import { NewLogSource } from "./logs.creator.view.tsx";
import { logsModel, sourcesOf } from "./logs.model.ts";

function SourceRow(props: { adapter: AdapterWithProject }): JSX.Element {
  const path = (): string => `/projects/${props.adapter.project_slug}/adapters/${props.adapter.id}`;
  const sources = (): string[] => sourcesOf(props.adapter).map((source) => source.name);
  return (
    <Row>
      <Cell>
        <a class="font-medium hover:underline" href={href(path())}>
          {props.adapter.name}
        </a>
      </Cell>
      <Cell>{ENGINE_LABEL[props.adapter.engine]}</Cell>
      <Cell class="text-muted">
        {/* An ingest adapter's sources are the services that push to it, listed on its page. */}
        {props.adapter.engine === "ingest" ? "Pushed by your apps" : sources().join(", ")}
      </Cell>
      <Cell>
        <Badge variant={STATUS_VARIANT[props.adapter.status]}>
          {ADAPTER_STATUS_LABEL[props.adapter.status]}
        </Badge>
      </Cell>
    </Row>
  );
}

/**
 * Every log adapter in scope, grouped by project, Inspect first (a tier is a menu, Q3b of
 * docs/decisions/2026-10-10-logs-tier.md). A log adapter is always read-only, so there is no Mode.
 */
export default function LogsView(): JSX.Element {
  const adapters = createRefreshable(() => logsModel.adapters());
  const only = new URLSearchParams(window.location.search).get("project") ?? "";
  return (
    <section class="grid gap-4">
      <PageHeader
        eyebrow="Workspace"
        title="Logs"
        description="Log files over SFTP or object storage, systemd journals over SSH, Docker containers, Grafana Loki, Elasticsearch, and logs your apps push, read-only, across every project you can see."
        actions={
          <Show when={hasRole("qa")}>
            <NewLogSource onCreated={() => adapters.refresh()} />
          </Show>
        }
      />
      <Errored
        fallback={(error) => (
          <Banner variant="error">
            {humanMessage(error(), "The log adapters could not be listed")}
          </Banner>
        )}
      >
        <Loading fallback={<p class="text-muted">Listing...</p>}>
          <Show
            when={adapters.value().length > 0}
            fallback={
              <EmptyState icon="file-text" title="No log adapters yet">
                Add one with the button above. It appears here under its project.
              </EmptyState>
            }
          >
            <div class="grid gap-5">
              <Show when={only !== ""}>
                <p class="text-sm text-muted">
                  One project only.{" "}
                  <a class="text-info-fg hover:underline" href={href("/logs")}>
                    Show every project
                  </a>
                </p>
              </Show>
              <For each={storeGroups(adapters.value(), only)}>
                {(group) => (
                  <section class="grid gap-2">
                    <h3 class="flex items-baseline gap-2 text-sm font-medium text-heading">
                      {group.name}
                      <Show when={group.inspect}>
                        <InspectBadge />
                      </Show>
                      <span class="text-xs text-muted">{group.stores.length}</span>
                    </h3>
                    <Table>
                      <thead>
                        <tr>
                          <Head>Name</Head>
                          <Head>Engine</Head>
                          <Head>Sources</Head>
                          <Head>Status</Head>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={group.stores}>
                          {(adapter) => <SourceRow adapter={adapter} />}
                        </For>
                      </tbody>
                    </Table>
                  </section>
                )}
              </For>
            </div>
            <TableFooter shown={adapters.value().length} noun="log adapters" hasMore={false} />
          </Show>
        </Loading>
      </Errored>
    </section>
  );
}
