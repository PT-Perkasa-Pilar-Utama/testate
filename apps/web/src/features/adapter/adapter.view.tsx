import type { JSX } from "@solidjs/web";
import { For, Loading, Match, Switch } from "solid-js";
import type { Entry, Introspection, RestRequest } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createAdapterPresenter } from "./adapter.presenter.ts";

function TablesView(props: { schema: Introspection }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Table</Head>
          <Head>Rows (est.)</Head>
          <Head>Columns</Head>
          <Head>Primary key</Head>
        </tr>
      </thead>
      <tbody>
        <For each={props.schema.tables}>
          {(table) => (
            <Row>
              <Cell>
                <code>{table.schema === null ? table.name : `${table.schema}.${table.name}`}</code>
              </Cell>
              <Cell>{table.row_estimate}</Cell>
              <Cell>{table.columns.length}</Cell>
              <Cell>{table.primary_key?.join(", ") ?? "none"}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

function FilesView(props: { entries: Entry[] }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Name</Head>
          <Head>Kind</Head>
          <Head>Size</Head>
          <Head>Modified</Head>
        </tr>
      </thead>
      <tbody>
        <For each={props.entries}>
          {(entry) => (
            <Row>
              <Cell>{entry.name}</Cell>
              <Cell>{entry.kind}</Cell>
              <Cell>{entry.size_bytes ?? ""}</Cell>
              <Cell>{entry.modified_at ?? ""}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

function RequestsView(props: { requests: RestRequest[] }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Name</Head>
          <Head>Method</Head>
          <Head>Path</Head>
          <Head>Expected</Head>
        </tr>
      </thead>
      <tbody>
        <For each={props.requests}>
          {(request) => (
            <Row>
              <Cell>{request.name}</Cell>
              <Cell>
                <Badge variant="outline">{request.method}</Badge>
              </Cell>
              <Cell>
                <code>{request.path}</code>
              </Cell>
              <Cell>{request.expected_status ?? "any"}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

export default function AdapterView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createAdapterPresenter(
    () => props.slug,
    () => props.id
  );
  return (
    <section class="grid gap-6">
      <Loading fallback={<p class="text-kumo-subtle">Loading adapter...</p>}>
        <div class="grid gap-1.5">
          <h2 class="text-lg font-semibold">{presenter.adapter.value().name}</h2>
          <p class="text-kumo-subtle">
            {presenter.adapter.value().engine} · {presenter.adapter.value().tier} tier ·{" "}
            {presenter.adapter.value().mode}
          </p>
        </div>
        <Switch>
          <Match when={presenter.tables()}>{(schema) => <TablesView schema={schema()} />}</Match>
          <Match when={presenter.entries()}>{(entries) => <FilesView entries={entries()} />}</Match>
          <Match when={presenter.requests()}>
            {(requests) => <RequestsView requests={requests()} />}
          </Match>
        </Switch>
      </Loading>
    </section>
  );
}
