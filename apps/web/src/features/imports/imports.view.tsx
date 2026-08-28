import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { countsLabel, createImportsPresenter } from "./imports.presenter.ts";

export default function ImportsView(props: { slug: string }): JSX.Element {
  const presenter = createImportsPresenter(() => props.slug);
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading import runs...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>Run</Head>
            <Head>Mode</Head>
            <Head>Dry run</Head>
            <Head>Counts</Head>
            <Head>By</Head>
            <Head>Started</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(run) => (
              <Row>
                <Cell>
                  <code>{run.id.slice(-8)}</code>
                </Cell>
                <Cell>{run.mode}</Cell>
                <Cell>
                  <Badge variant={run.dry_run ? "info" : "outline"}>
                    {run.dry_run ? "yes" : "no"}
                  </Badge>
                </Cell>
                <Cell>{countsLabel(run)}</Cell>
                <Cell>{run.actor.label}</Cell>
                <Cell>{run.created_at}</Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </Loading>
  );
}
