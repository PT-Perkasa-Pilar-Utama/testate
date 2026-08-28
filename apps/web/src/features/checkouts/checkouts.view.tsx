import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createCheckoutsPresenter } from "./checkouts.presenter.ts";

const STATUS_VARIANT = {
  running: "info",
  succeeded: "success",
  partial: "warning",
  failed: "error",
  cancelled: "secondary",
  interrupted: "warning",
} as const;

export default function CheckoutsView(props: { slug: string }): JSX.Element {
  const presenter = createCheckoutsPresenter(() => props.slug);
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading checkouts...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>State</Head>
            <Head>Purpose</Head>
            <Head>Status</Head>
            <Head>Adapters</Head>
            <Head>By</Head>
            <Head>Started</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(checkout) => (
              <Row>
                <Cell>{checkout.state.name}</Cell>
                <Cell>{checkout.purpose}</Cell>
                <Cell>
                  <Badge variant={STATUS_VARIANT[checkout.status]}>{checkout.status}</Badge>
                </Cell>
                <Cell>
                  {checkout.adapters
                    .map((adapter) => `${adapter.name}: ${adapter.result}`)
                    .join(", ")}
                </Cell>
                <Cell>{checkout.actor.label}</Cell>
                <Cell>{checkout.created_at}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </Loading>
  );
}
