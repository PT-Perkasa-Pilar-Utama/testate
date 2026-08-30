import type { JSX } from "@solidjs/web";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import { For, Loading, Show } from "solid-js";
import type { QueryResult } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { cellText } from "./grid.presenter.ts";
import { MONGO_OPS, createQueryPresenter } from "./query.presenter.ts";
import SidePanel from "./query-side.view.tsx";
import type { QueryPresenter } from "./query.presenter.ts";

const ENFORCEMENT_VARIANT = {
  transaction: "success",
  credential: "success",
  filter: "warning",
} as const;
const ENFORCEMENT_TEXT = {
  transaction: "read-only transaction",
  credential: "read-only credential",
  filter: "application filter only",
} as const;

function MongoForm(props: { presenter: QueryPresenter }): JSX.Element {
  const draft = (): ReturnType<QueryPresenter["mongo"]> => props.presenter.mongo();
  return (
    <div class="grid gap-3">
      <div class="flex flex-wrap gap-2">
        <Select
          aria-label="Operation"
          options={MONGO_OPS}
          value={draft().op}
          onChange={(op) => props.presenter.setMongo({ op })}
        />
        <Input
          aria-label="Collection"
          placeholder="collection"
          value={draft().collection}
          onInput={(event) => props.presenter.setMongo({ collection: event.currentTarget.value })}
        />
      </div>
      <Show
        when={draft().op === "find"}
        fallback={
          <label class="grid gap-1.5 text-sm">
            <span>Pipeline (JSON array)</span>
            <InputArea
              rows={8}
              class="font-mono"
              value={draft().pipeline}
              onInput={(event) => props.presenter.setMongo({ pipeline: event.currentTarget.value })}
            />
          </label>
        }
      >
        <label class="grid gap-1.5 text-sm">
          <span>Filter (JSON)</span>
          <InputArea
            rows={4}
            class="font-mono"
            value={draft().filter}
            onInput={(event) => props.presenter.setMongo({ filter: event.currentTarget.value })}
          />
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1.5 text-sm">
            <span>Projection (JSON, optional)</span>
            <Input
              class="font-mono"
              value={draft().projection}
              onInput={(event) =>
                props.presenter.setMongo({ projection: event.currentTarget.value })
              }
            />
          </label>
          <label class="grid gap-1.5 text-sm">
            <span>Sort (JSON, optional)</span>
            <Input
              class="font-mono"
              value={draft().sort}
              onInput={(event) => props.presenter.setMongo({ sort: event.currentTarget.value })}
            />
          </label>
        </div>
      </Show>
    </div>
  );
}

function ResultTable(props: { result: QueryResult }): JSX.Element {
  return (
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={ENFORCEMENT_VARIANT[props.result.read_only_enforcement]}>
          {ENFORCEMENT_TEXT[props.result.read_only_enforcement]}
        </Badge>
        <span class="text-kumo-subtle">
          {props.result.rows.length} row(s) · {props.result.duration_ms} ms
        </span>
        <Show when={props.result.truncated.rows}>
          <Badge variant="warning">row cap hit</Badge>
        </Show>
        <Show when={props.result.truncated.bytes}>
          <Badge variant="warning">byte budget hit</Badge>
        </Show>
        <Show when={props.result.truncated.time}>
          <Badge variant="warning">time budget hit</Badge>
        </Show>
        <Show when={props.result.masked_columns.length > 0}>
          <span class="text-kumo-subtle">masked: {props.result.masked_columns.join(", ")}</span>
        </Show>
      </div>
      <div class="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <For each={props.result.columns}>{(column) => <Head>{column.name}</Head>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={props.result.rows}>
              {(row) => (
                <Row>
                  <For each={props.result.columns}>
                    {(column) => <Cell>{cellText(row[column.name])}</Cell>}
                  </For>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
      </div>
    </div>
  );
}

export default function QueryView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createQueryPresenter(
    () => props.slug,
    () => props.id
  );
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void presenter.run();
  };
  return (
    <section class="grid gap-4">
      <h2 class="text-lg font-semibold">
        <AdapterCrumb slug={props.slug} id={props.id} /> / query console
      </h2>
      <Loading fallback={<p class="text-kumo-subtle">Loading adapter...</p>}>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          <form class="grid gap-3" onSubmit={onSubmit}>
            <Show
              when={presenter.isMongo()}
              fallback={
                <InputArea
                  rows={8}
                  class="font-mono"
                  aria-label="SQL"
                  placeholder="SELECT ..."
                  value={presenter.sql()}
                  onInput={(event) => presenter.setSql(event.currentTarget.value)}
                />
              }
            >
              <MongoForm presenter={presenter} />
            </Show>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="primary" disabled={presenter.busy()}>
                  {presenter.busy() ? "Running..." : "Run (read-only)"}
                </Button>
                <label class="flex items-center gap-2 text-xs text-kumo-subtle">
                  <span>Row cap</span>
                  <Input
                    size="sm"
                    class="w-24!"
                    type="number"
                    min="1"
                    max="5000"
                    value={presenter.rowCap()}
                    onInput={(event) => presenter.setRowCap(event.currentTarget.value)}
                  />
                </label>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void presenter.exportAs("csv")}
                >
                  Export CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void presenter.exportAs("json")}
                >
                  Export JSON
                </Button>
              </div>
            </div>
            <Show when={presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <Show when={presenter.result()}>{(result) => <ResultTable result={result()} />}</Show>
          </form>
          <SidePanel presenter={presenter} />
        </div>
      </Loading>
    </section>
  );
}
