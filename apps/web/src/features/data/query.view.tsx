import type { JSX } from "@solidjs/web";
import AdapterBreadcrumbs from "@/features/adapter/adapter.crumb.view.tsx";
import { Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Icon from "@/components/icon.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { MONGO_OPS, createQueryPresenter } from "./query.presenter.ts";
import ResultTable from "./query-result.view.tsx";
import SidePanel from "./query-side.view.tsx";
import type { QueryPresenter } from "./query.presenter.ts";

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
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={false}>Pipeline (JSON array)</FieldLabel>
            <InputArea
              rows={8}
              class="bg-sunken! font-mono"
              value={draft().pipeline}
              onInput={(event) => props.presenter.setMongo({ pipeline: event.currentTarget.value })}
            />
          </label>
        }
      >
        <label class="grid content-start gap-1.5 text-base">
          <FieldLabel required={false}>Filter (JSON)</FieldLabel>
          <InputArea
            rows={4}
            class="bg-sunken! font-mono"
            value={draft().filter}
            onInput={(event) => props.presenter.setMongo({ filter: event.currentTarget.value })}
          />
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={false}>Projection (JSON)</FieldLabel>
            <Input
              class="font-mono"
              value={draft().projection}
              onInput={(event) =>
                props.presenter.setMongo({ projection: event.currentTarget.value })
              }
            />
          </label>
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={false}>Sort (JSON)</FieldLabel>
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

/** The editor's own title bar, so the query box reads as a console rather than a plain textarea. */
function ConsoleLabel(props: { mongo: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-1.5 text-xs text-muted">
      <Icon name="terminal" class="h-3.5 w-3.5" />
      <span>{props.mongo ? "Mongo operation" : "SQL"}</span>
      <Badge variant="secondary">read-only</Badge>
    </div>
  );
}

/** Runs read-only, on-screen only: the row cap trims what renders below, never what an export gets. */
function RowCapField(props: { presenter: QueryPresenter }): JSX.Element {
  return (
    <div class="grid gap-0.5">
      <label class="flex items-center gap-2 text-xs text-muted">
        <FieldLabel required={false}>Row cap</FieldLabel>
        <Input
          size="sm"
          class="w-20!"
          type="number"
          min="1"
          max="5000"
          value={props.presenter.rowCap()}
          onInput={(event) => props.presenter.setRowCap(event.currentTarget.value)}
        />
      </label>
      <span class="text-xs text-muted">
        Limits the rows shown here. Exports are not capped by it.
      </span>
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
      <AdapterBreadcrumbs slug={props.slug} id={props.id} leaf="query console" />
      <h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight text-heading">
        <Icon name="terminal" class="h-4 w-4 text-muted" />
        Query console
      </h2>
      <Loading fallback={<Pending>Loading adapter...</Pending>}>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          <form class="grid gap-3" onSubmit={onSubmit}>
            <Show
              when={presenter.isMongo()}
              fallback={
                <div class="grid gap-1.5">
                  <ConsoleLabel mongo={false} />
                  <InputArea
                    rows={8}
                    class="bg-sunken! font-mono"
                    aria-label="SQL"
                    placeholder="SELECT ..."
                    value={presenter.sql()}
                    onInput={(event) => presenter.setSql(event.currentTarget.value)}
                  />
                </div>
              }
            >
              <ConsoleLabel mongo />
              <MongoForm presenter={presenter} />
            </Show>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" disabled={presenter.busy()}>
                  {presenter.busy() ? "Running..." : "Run (read-only)"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  title="Fill the console with a query against the first table"
                  onClick={() => void presenter.sample()}
                >
                  Sample
                </Button>
                <RowCapField presenter={presenter} />
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void presenter.exportAs("csv")}
                >
                  <Icon name="download" class="h-3.5 w-3.5" />
                  Export CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void presenter.exportAs("json")}
                >
                  <Icon name="download" class="h-3.5 w-3.5" />
                  Export JSON
                </Button>
              </div>
            </div>
            <Show when={presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <Show
              when={presenter.result()}
              fallback={
                <Show when={presenter.error() === null}>
                  <EmptyState icon="terminal" title="Nothing run yet">
                    Write a query above and press Run. It executes read-only, whatever you enter.
                  </EmptyState>
                </Show>
              }
            >
              {(result) => <ResultTable result={result()} documents={presenter.isMongo()} />}
            </Show>
          </form>
          <SidePanel presenter={presenter} />
        </div>
      </Loading>
    </section>
  );
}
