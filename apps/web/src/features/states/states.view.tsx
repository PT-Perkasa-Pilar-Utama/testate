import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createStatesPresenter, formatBytes } from "./states.presenter.ts";

export default function StatesView(props: { slug: string }): JSX.Element {
  const presenter = createStatesPresenter(() => props.slug);
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading states...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>Name</Head>
            <Head>Kind</Head>
            <Head>Status</Head>
            <Head>Adapters</Head>
            <Head>Size</Head>
            <Head>Taken</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(state) => (
              <Row>
                <Cell>
                  <span class="inline-flex items-center gap-2">
                    {state.name}
                    <Show when={state.protected}>
                      <Badge variant="warning">protected</Badge>
                    </Show>
                  </span>
                </Cell>
                <Cell>
                  <Badge variant={state.kind === "init" ? "primary" : "outline"}>
                    {state.kind}
                  </Badge>
                </Cell>
                <Cell>{state.status}</Cell>
                <Cell>{state.adapters.map((adapter) => adapter.adapter_name).join(", ")}</Cell>
                <Cell>{formatBytes(state.size_bytes)}</Cell>
                <Cell>{state.created_at}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </Loading>
  );
}
