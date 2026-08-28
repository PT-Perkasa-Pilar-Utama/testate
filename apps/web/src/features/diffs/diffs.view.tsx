import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { changedRows, createDiffsPresenter, targetLabel } from "./diffs.presenter.ts";

const STATUS_VARIANT = { running: "info", ready: "success", failed: "error" } as const;

export default function DiffsView(props: { slug: string }): JSX.Element {
  const presenter = createDiffsPresenter(() => props.slug);
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading diffs...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>Base</Head>
            <Head>Target</Head>
            <Head>Status</Head>
            <Head>Changed rows</Head>
            <Head>Expires</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(diff) => (
              <Row>
                <Cell>{diff.base.name}</Cell>
                <Cell>{targetLabel(diff.target)}</Cell>
                <Cell>
                  <Badge variant={STATUS_VARIANT[diff.status]}>{diff.status}</Badge>
                </Cell>
                <Cell>{changedRows(diff)}</Cell>
                <Cell>{diff.expires_at}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </Loading>
  );
}
