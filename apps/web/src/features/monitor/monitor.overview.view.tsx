import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import EmptyState from "@/components/empty-state.tsx";
import PageHeader from "@/components/page-header.tsx";
import Pending from "@/components/pending.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { formatAgo } from "@/lib/format.ts";
import { href, navigate } from "@/lib/router.ts";
import { formatValue } from "./monitor.format.ts";
import { createMonitorOverviewPresenter } from "./monitor.overview.presenter.ts";
import type { HostRow, ServerRow } from "./monitor.overview.ts";

const shown = (value: number | null, unit: Parameters<typeof formatValue>[1]): string =>
  value === null ? "not read" : formatValue(value, unit);
const share = (value: number | null): string =>
  value === null ? "not read" : formatValue(value * 100, "percent");

/** The adapter's name, linking to its project's graphs. */
function GraphLink(props: { row: HostRow | ServerRow }): JSX.Element {
  const path = (): string => `/projects/${encodeURIComponent(props.row.project.slug)}?tab=monitor`;
  return (
    <a
      class="font-medium text-link hover:text-accent-hover"
      href={href(path())}
      onClick={(event) => {
        event.preventDefault();
        navigate(path());
      }}
    >
      {props.row.name}
    </a>
  );
}

function Hosts(props: { rows: HostRow[] }): JSX.Element {
  return (
    <section class="grid gap-3">
      <h2 class="text-lg font-semibold tracking-tight text-heading">Hosts</h2>
      <Table>
        <thead>
          <tr>
            <Head>Host</Head>
            <Head>Project</Head>
            <Head numeric>CPU</Head>
            <Head numeric>Memory</Head>
            <Head numeric>Disk</Head>
            <Head numeric>Load</Head>
            <Head numeric>Apps</Head>
            <Head>Sampled</Head>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <Row>
                <Cell>
                  <GraphLink row={row} />
                </Cell>
                <Cell>{row.project.name}</Cell>
                <Cell numeric>{shown(row.cpu, "percent")}</Cell>
                <Cell numeric>{share(row.memory)}</Cell>
                <Cell numeric>{share(row.disk)}</Cell>
                <Cell numeric>{shown(row.load, "load")}</Cell>
                <Cell numeric>{row.apps}</Cell>
                <Cell>{formatAgo(row.taken_at)}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </section>
  );
}

function Servers(props: { rows: ServerRow[] }): JSX.Element {
  return (
    <section class="grid gap-3">
      <h2 class="text-lg font-semibold tracking-tight text-heading">Database servers</h2>
      <Table>
        <thead>
          <tr>
            <Head>Database</Head>
            <Head>Project</Head>
            <Head numeric>Connections</Head>
            <Head numeric>Size</Head>
            <Head>Sampled</Head>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <Row>
                <Cell>
                  <GraphLink row={row} />
                </Cell>
                <Cell>{row.project.name}</Cell>
                <Cell numeric>{shown(row.connections, "count")}</Cell>
                <Cell numeric>{shown(row.size, "bytes")}</Cell>
                <Cell>{formatAgo(row.taken_at)}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </section>
  );
}

/** The Monitor menu (#101): the newest sample of every host and server; a name opens its graphs. */
export default function MonitorOverviewView(): JSX.Element {
  const presenter = createMonitorOverviewPresenter();
  return (
    <div class="grid gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Monitor"
        description="The hosts, pm2 apps and database servers behind every project you can see, sampled on an interval."
      />
      <Loading fallback={<Pending>Loading the latest samples...</Pending>}>
        <Show
          when={
            presenter.overview.value().hosts.length + presenter.overview.value().servers.length > 0
          }
          fallback={
            <EmptyState icon="gauge" title="Nothing sampled yet">
              Testate samples a project's SFTP hosts and database servers on an interval. Add one to
              a project and its first sample shows here within a minute.
            </EmptyState>
          }
        >
          <Show when={presenter.overview.value().hosts.length > 0}>
            <Hosts rows={presenter.overview.value().hosts} />
          </Show>
          <Show when={presenter.overview.value().servers.length > 0}>
            <Servers rows={presenter.overview.value().servers} />
          </Show>
        </Show>
      </Loading>
    </div>
  );
}
