import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createSettingsPresenter } from "./settings.presenter.ts";
import type { SettingsPresenter } from "./settings.presenter.ts";

const SECTIONS = ["retention", "limits", "quota"] as const;

function Section(props: {
  presenter: SettingsPresenter;
  name: (typeof SECTIONS)[number];
}): JSX.Element {
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <h3 class="font-medium capitalize">{props.name}</h3>
      <Table>
        <thead>
          <tr>
            <Head>Key</Head>
            <Head>Value</Head>
            <Head>Source</Head>
          </tr>
        </thead>
        <tbody>
          <For each={props.presenter.rows(props.name)}>
            {(row) => (
              <Row>
                <Cell>
                  <code>{row.key}</code>
                </Cell>
                <Cell>{row.value}</Cell>
                <Cell>
                  <Badge variant={row.locked ? "warning" : "outline"}>
                    {row.locked ? "environment" : "editable"}
                  </Badge>
                </Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </LayerCard>
  );
}

export default function SettingsView(): JSX.Element {
  const presenter = createSettingsPresenter();
  return (
    <section class="grid gap-6">
      <div class="grid gap-1.5">
        <h2 class="text-lg font-semibold">Settings</h2>
        <p class="text-kumo-subtle">
          Instance defaults. Values set by the environment cannot be edited here.
        </p>
      </div>
      <Loading fallback={<p class="text-kumo-subtle">Loading settings...</p>}>
        <LayerCard class="flex items-center gap-3 px-5 py-4">
          <span class="text-sm">Snapshot store</span>
          <Badge variant="outline">{presenter.value().store.driver}</Badge>
          <Badge variant={presenter.value().store.locked_by_env ? "warning" : "secondary"}>
            {presenter.value().store.locked_by_env ? "set by environment" : "editable"}
          </Badge>
        </LayerCard>
        <For each={SECTIONS}>{(name) => <Section presenter={presenter} name={name} />}</For>
      </Loading>
    </section>
  );
}
