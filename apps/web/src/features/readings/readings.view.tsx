import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";
import type { Reading } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Pending from "@/components/pending.tsx";
import { Cell, EmptyRow, Head, Row, Table } from "@/components/table.tsx";
import { formatWhen } from "@/lib/format.ts";
import { hasRole } from "@/lib/session.ts";
import { changeOf, compareReadings, formatValue, labelOf } from "./readings.compare.ts";
import { createReadingsPresenter, pickedReadings } from "./readings.presenter.ts";
import type { ReadingsPresenter } from "./readings.presenter.ts";

const unavailableOf = (reading: Reading): number =>
  reading.adapters.reduce((sum, adapter) => sum + adapter.unavailable.length, 0);

function ReadingRow(props: { presenter: ReadingsPresenter; reading: Reading }): JSX.Element {
  const picked = (): boolean => props.presenter.picked().includes(props.reading.id);
  return (
    <Row>
      <Cell>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="h-4 w-4 accent-accent"
            aria-label={`Pick the reading of ${formatWhen(props.reading.taken_at)}`}
            checked={picked()}
            onChange={() => props.presenter.toggle(props.reading.id)}
          />
          <span>{formatWhen(props.reading.taken_at)}</span>
        </label>
      </Cell>
      <Cell>{props.reading.actor.label}</Cell>
      <Cell numeric>{props.reading.adapters.length}</Cell>
      <Cell numeric>{unavailableOf(props.reading)}</Cell>
    </Row>
  );
}

/** One reading: per adapter, what it read and what it could not, with why. */
function ReadingDetail(props: { reading: Reading }): JSX.Element {
  return (
    <div class="grid gap-4">
      <For each={props.reading.adapters}>
        {(adapter) => (
          <section class="grid gap-2">
            <h3 class="text-base font-semibold tracking-tight text-heading">
              {adapter.name}{" "}
              <span class="font-normal text-muted">
                {adapter.source === "host" ? "host" : "database server"}
              </span>
            </h3>
            <Table>
              <tbody>
                <For each={adapter.values}>
                  {(item) => (
                    <Row>
                      <Cell>{labelOf(item.key)}</Cell>
                      <Cell numeric>{formatValue(item.value, item.unit)}</Cell>
                    </Row>
                  )}
                </For>
                <For each={adapter.unavailable}>
                  {(gap) => (
                    <Row>
                      <Cell>{labelOf(gap.key)}</Cell>
                      <Cell wrap class="text-muted">
                        Not read: {gap.reason}
                      </Cell>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
          </section>
        )}
      </For>
    </div>
  );
}

/** Two readings side by side, older first, with the change per value. */
function ReadingCompare(props: { older: Reading; newer: Reading }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Adapter</Head>
          <Head>Value</Head>
          <Head numeric>{formatWhen(props.older.taken_at)}</Head>
          <Head numeric>{formatWhen(props.newer.taken_at)}</Head>
          <Head numeric>Change</Head>
        </tr>
      </thead>
      <tbody>
        <For each={compareReadings(props.older, props.newer)}>
          {(row) => (
            <Row>
              <Cell>{row.adapter}</Cell>
              <Cell>{labelOf(row.key)}</Cell>
              <Cell numeric>
                {row.older === null ? "not read" : formatValue(row.older, row.unit)}
              </Cell>
              <Cell numeric>
                {row.newer === null ? "not read" : formatValue(row.newer, row.unit)}
              </Cell>
              <Cell numeric>{changeOf(row.older, row.newer, row.unit) ?? ""}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

function Picked(props: { presenter: ReadingsPresenter }): JSX.Element {
  const chosen = (): Reading[] =>
    pickedReadings(props.presenter.list.value(), props.presenter.picked());
  return (
    <Show
      when={chosen().length === 2}
      fallback={<Show when={chosen()[0]}>{(one) => <ReadingDetail reading={one()} />}</Show>}
    >
      <Show when={chosen()[0]}>
        {(older) => (
          <Show when={chosen()[1]}>
            {(newer) => <ReadingCompare older={older()} newer={newer()} />}
          </Show>
        )}
      </Show>
    </Show>
  );
}

/**
 * Resource readings (#38): what the hosts and database servers behind this project were doing at a
 * moment. Not a time series; pick one to read it, two to compare them.
 */
export default function ReadingsView(props: { slug: string }): JSX.Element {
  const presenter = createReadingsPresenter(() => props.slug);
  return (
    <div class="grid gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          Load, memory and disk of the SFTP hosts, and the database servers' counters. Pick one
          reading to read it, two to compare.
        </p>
        <Show when={hasRole("qa")}>
          <Button
            variant="secondary"
            disabled={presenter.taking()}
            onClick={() => void presenter.take()}
          >
            {presenter.taking() ? "Reading..." : "Take reading"}
          </Button>
        </Show>
      </div>
      <Show when={presenter.error()}>
        {(message) => <Banner variant="error">{message()}</Banner>}
      </Show>
      <Loading fallback={<Pending>Loading readings...</Pending>}>
        <Table>
          <thead>
            <tr>
              <Head>Taken</Head>
              <Head>By</Head>
              <Head numeric>Adapters</Head>
              <Head numeric>Not read</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.list.value().length > 0}
              fallback={
                <EmptyRow>
                  No readings yet. Take one before a test run and one after it to see what the
                  machines were doing.
                </EmptyRow>
              }
            >
              <For each={presenter.list.value()}>
                {(reading) => <ReadingRow presenter={presenter} reading={reading} />}
              </For>
            </Show>
          </tbody>
        </Table>
        <Picked presenter={presenter} />
      </Loading>
    </div>
  );
}
