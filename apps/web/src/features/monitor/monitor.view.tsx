import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";
import type { Reading } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import LineChart from "@/components/line-chart.tsx";
import Pending from "@/components/pending.tsx";
import Tabs from "@/components/tabs.tsx";
import { formatAgo } from "@/lib/format.ts";
import { hasRole } from "@/lib/session.ts";
import { formatterOf } from "./monitor.charts.ts";
import type { AdapterCharts } from "./monitor.charts.ts";
import { labelOf } from "./monitor.format.ts";
import { createMonitorPresenter, RANGES } from "./monitor.presenter.ts";
import type { MonitorView as View } from "./monitor.presenter.ts";

/** What the newest reading could not read for this adapter, each reason once. */
function gapsOf(latest: Reading | null, adapterId: string): string[] {
  const adapter = latest?.adapters.find((item) => item.adapter_id === adapterId);
  const reasons = new Map<string, string[]>();
  for (const gap of adapter?.unavailable ?? []) {
    reasons.set(gap.reason, [...(reasons.get(gap.reason) ?? []), labelOf(gap.key)]);
  }
  return [...reasons].map(([reason, keys]) => `${keys.join(", ")}: ${reason}`);
}

function AdapterSection(props: {
  adapter: AdapterCharts;
  view: View;
  latest: Reading | null;
}): JSX.Element {
  return (
    <section class="grid gap-3">
      <h3 class="flex items-baseline gap-2 text-lg font-semibold tracking-tight text-heading">
        {props.adapter.name}
        <span class="text-sm font-normal text-muted">
          {props.adapter.source === "host" ? "host" : "database server"}
        </span>
      </h3>
      <For each={gapsOf(props.latest, props.adapter.adapter_id)}>
        {(gap) => <p class="text-sm text-muted">Not read: {gap}</p>}
      </For>
      <div class="grid gap-4 lg:grid-cols-2">
        <For each={props.adapter.charts}>
          {(chart) => (
            <LineChart
              title={chart.title}
              lines={chart.lines}
              from={props.view.from}
              to={props.view.to}
              stepMs={props.view.stepMs}
              format={formatterOf(chart.unit)}
              binary={chart.unit === "bytes" || chart.unit === "bytes_per_second"}
              {...(chart.max === undefined ? {} : { max: chart.max })}
            />
          )}
        </For>
      </div>
    </section>
  );
}

/**
 * The monitor (#101): the hosts, the pm2 apps and the database servers behind this project, over
 * time. Testate samples them on an interval; Sample now takes one more by hand.
 */
export default function MonitorView(props: { slug: string }): JSX.Element {
  const presenter = createMonitorPresenter(() => props.slug);
  return (
    <div class="grid gap-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          variant="segmented"
          label="Window"
          items={RANGES}
          value={presenter.range()}
          onChange={presenter.setRange}
        />
        <div class="flex items-center gap-3">
          <Loading fallback={null}>
            <Show when={presenter.latest.value()}>
              {(latest) => (
                <span class="text-sm text-muted">Sampled {formatAgo(latest().taken_at)}</span>
              )}
            </Show>
          </Loading>
          <Show when={hasRole("qa")}>
            <Button
              variant="secondary"
              disabled={presenter.taking()}
              onClick={() => void presenter.take()}
            >
              {presenter.taking() ? "Sampling..." : "Sample now"}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={presenter.error()}>
        {(message) => <Banner variant="error">{message()}</Banner>}
      </Show>
      <Loading fallback={<Pending>Loading the graphs...</Pending>}>
        <Show
          when={presenter.view.value().adapters.length > 0}
          fallback={
            <EmptyState icon="gauge" title="Nothing sampled in this window">
              Testate samples the SFTP hosts and the database servers of this project on an
              interval. Add one, or widen the window.
            </EmptyState>
          }
        >
          <For each={presenter.view.value().adapters}>
            {(adapter) => (
              <AdapterSection
                adapter={adapter}
                view={presenter.view.value()}
                latest={presenter.latest.value()}
              />
            )}
          </For>
        </Show>
      </Loading>
    </div>
  );
}
