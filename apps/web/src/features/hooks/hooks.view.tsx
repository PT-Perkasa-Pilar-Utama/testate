import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createHooksPresenter } from "./hooks.presenter.ts";

export default function HooksView(props: { slug: string }): JSX.Element {
  const presenter = createHooksPresenter(() => props.slug);
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading hooks...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>Order</Head>
            <Head>Trigger</Head>
            <Head>Request</Head>
            <Head>On failure</Head>
            <Head>Enabled</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(hook) => (
              <Row>
                <Cell>{hook.position}</Cell>
                <Cell>
                  <code>{hook.trigger}</code>
                </Cell>
                <Cell>{hook.request.name}</Cell>
                <Cell>{hook.fail_policy}</Cell>
                <Cell>
                  <Badge variant={hook.enabled ? "success" : "secondary"}>
                    {hook.enabled ? "on" : "off"}
                  </Badge>
                </Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </Loading>
  );
}
